# Wompi provider — work log

> Build journal for matesjara/xcale-mcp-server#159 on `feat/159-wompi-provider` (from `dev` @ `55f2cba`).
> Design: [`feature-design.md`](./feature-design.md) · [`api-contract.md`](./api-contract.md) ·
> [`implementation-plan.md`](./implementation-plan.md) (on `docs/159-wompi-provider`, PR #160).
> Each slice is built test-first (red → green, one behaviour at a time).

---

## Phase A1 — foundation: context, auth, client, errors

No tools yet. A1 builds the four pieces every tool in A2 stands on, so A2 only adds request shapes.

| Slice | What                                                                                                              | Files              | Tests                                         |
| :---- | :---------------------------------------------------------------------------------------------------------------- | :----------------- | :-------------------------------------------- |
| A1.1  | Call context: `publicKey` required, `environment` optional (`sandbox` \| `production`), strict                    | `wompi/context.ts` | `__tests__/context.test.ts`                   |
| A1.2  | Auth descriptor: bearer, one field `private_key`, header, forwarded                                               | `wompi/auth.ts`    | `__tests__/context.test.ts` (catalog surface) |
| A1.3  | Client: base URL chosen by `environment`; fails closed, without a request, when it is missing                     | `wompi/client.ts`  | `__tests__/client.test.ts`                    |
| A1.4  | Error unwrap: core status policy → own message; **never the Wompi body**; unexpected 2xx shape → `PROVIDER_ERROR` | `wompi/errors.ts`  | `__tests__/errors.test.ts`                    |

- [x] A1.1 · [x] A1.2 · [x] A1.3 · [x] A1.4 — 2026-10-22

#### What each slice proved

| Slice | Red → green                                                                                                                                                                                                                                                                                              | Tests |
| :---- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---- |
| A1.1  | Context accepts the public key with either environment; `environment` optional; refuses an empty public key, another environment and undeclared keys                                                                                                                                                     | 4     |
| A1.2  | The descriptor forwards one secret, the private key, as a bearer header                                                                                                                                                                                                                                  | 1     |
| A1.3  | Sandbox → `sandbox.wompi.co/v1`, production → `production.wompi.co/v1`, query kept; `post` sends JSON with its `content-type`; **no `environment` → `WompiEnvironmentMissing` and no request** (both methods). The first green had a `?? 'sandbox'` default on purpose; the fail-closed test removed it. | 5     |
| A1.4  | `401` → `PROVIDER_AUTH_EXPIRED` with our message; `422` → `PROVIDER_INVALID_INPUT` without Wompi's text; `429` / `5xx` keep the core's code; no response at all → "unreachable"; success unwraps Wompi's `{ data }`; a 2xx without it → `PROVIDER_ERROR`                                                 | 7     |

**Redaction guard checked against a mutant.** With the message changed to include the response body, the three error tests that carry a body failed; restored, they pass. The fake key in the test is visibly fake (`prv_test_FAKEKEY…`), never derived from a real one.

**Gate A1:** `npm run typecheck` clean · `npx vitest run` 651/651 (49 files) · Prettier clean.

### Decisions taken while building

- **Status → code comes from the core** (`mapHttpStatusToErrorCode`, `src/core/http.ts`), identical for every provider. The contract listed `404` as `PROVIDER_INVALID_INPUT`; the core maps it to `PROVIDER_ERROR`, and the core's policy wins ("share policies, not assumptions"). The contract table is corrected.
- **`res.body` is never read.** The core already trims and query-redacts it, but Wompi's JSON error repeats the key in a field (`reason`), which query redaction does not touch.

### Finding: Wompi deactivates links only with `PATCH` — resolved in this branch

The core transports `GET | POST | PUT | DELETE` (`src/core/auth/http-request.ts`, `HttpMethod`). Verified on 2026-10-22 against the sandbox:

| Call                                              | Result                           |
| :------------------------------------------------ | :------------------------------- |
| `PATCH /payment_links/{id}` `{ "active": false }` | `200`, `active: false` (spike)   |
| `PUT /payment_links/{id}` `{ "active": false }`   | `404` — the route does not exist |

So `mcp_wompi_deactivate_payment_link` needs `PATCH` in the core's `HttpMethod` — a change to `src/core`, outside Provider Self-Containment.

**How it ships (decided 2026-10-22):** in this branch, as **its own commit** (`470d1a0 feat(core): transport PATCH`), not a separate PR. Precedent: `DELETE` entered the core exactly this way, inside the Cloudbeds commit that needed it (`7b7a3bc`, "a generic HTTP verb the core already transports for every provider, not provider knowledge… argued in place"). A separate PR would have forced this branch to wait for its merge (no stacked PRs). The materializer (`authentication-materializer.ts:78`) and the transport (`http.ts:77`) pass the method through untouched, so the verb and its doc comment are the whole change.

- [x] Core: `PATCH` in `HttpMethod` (`470d1a0`).
- [x] Client: `patch()` — red → green → refactor (`post` and `patch` now share one JSON sender) (`fe7d162`). 2 tests; suite 653/653; `tsc` clean.
- [ ] **PR body must carry a "Touches the core" section**: the one-line change, the sandbox evidence (`PUT` 404 / `PATCH` 200), the `DELETE` precedent, and that it is isolated in `470d1a0` for review. The template's forbidden box is ticked with that justification (same as `7b7a3bc`, which had no separate ADR).

---

## Phase A2 — the four tools, the provider and its registration

Every test goes through `provider.callTool(…)` with a recording `fetch` double, so the request is checked
as the core's materializer really sends it (bearer header included), not as the client builds it.

| Slice | What                                                               | Files                                                                   | Behaviours (red → green, in order)                                                                                                                                                                                                                                                                  |
| :---- | :----------------------------------------------------------------- | :---------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A2.1  | Manifest, provider assembly, `mcp_wompi_check_credentials` (probe) | `manifest.ts`, `tools.ts`, `provider.ts`, `index.ts`                    | probe calls `GET /transactions?reference=xcale-connection-probe` with `Authorization: Bearer <private key>` → `{ valid: true }`; a rejected key → `PROVIDER_AUTH_EXPIRED`; no environment → `PROVIDER_INVALID_INPUT` and no request; catalog surface (manifest probe, account keys, context schema) |
| A2.2  | `mcp_wompi_create_payment_link`                                    | `tools.ts`                                                              | exact Wompi body (`single_use: true`, `collect_shipping: false`, `sku`); returns `linkId` + built checkout URL; empty `description` refused before any request; a `422` keeps our message                                                                                                           |
| A2.3  | `mcp_wompi_deactivate_payment_link`                                | `tools.ts`                                                              | `PATCH /payment_links/{id}` with `{ active: false }`; returns `{ linkId, active: false }`                                                                                                                                                                                                           |
| A2.4  | `mcp_wompi_list_transactions`                                      | `tools.ts`                                                              | date params + `page_size=200`; follows pages to `total_results`; `PROVIDER_ERROR` past 50 pages; `untilDate <= fromDate` refused before any request; payer data dropped                                                                                                                             |
| A2.5  | Registration, conformance, logo                                    | `src/providers/index.ts`, `assets/wompi.svg`, `__tests__/wompi.test.ts` | `wompiProvider` in `PROVIDERS`; `tools/list` publishes none of the four; each is callable by name; the repo-wide provider tests pass with Wompi registered                                                                                                                                          |

- [x] A2.1 · [x] A2.2 · [x] A2.3 · [x] A2.4 · [x] A2.5 — 2026-10-22

#### What each slice proved

| Slice | Red → green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Tests |
| :---- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :---- |
| A2.1  | The probe sends `GET sandbox.wompi.co/v1/transactions?reference=xcale-connection-probe` with `Authorization: Bearer <private key>` (as the materializer sends it) and answers `{ valid: true }`; Wompi's `401` → `PROVIDER_AUTH_EXPIRED`; a connection with no `environment` → `PROVIDER_INVALID_INPUT` with no request (`guarded` turns the client's `WompiEnvironmentMissing` into the typed error). Catalog: the context schema requires only `publicKey`, so the consumer's generated form never asks for `environment`; the manifest names its probe and `accountContextKeys: ['publicKey']` | 5     |
| A2.2  | Wompi receives exactly `{ name, description, single_use: true, collect_shipping: false, currency, amount_in_cents, expires_at, sku }`; the result is `{ linkId, url: https://checkout.wompi.co/l/{id}, expiresAt, active }` (Wompi returns no URL); an empty `description` is refused with no request; a `422` below the minimum keeps our message, not Wompi's text; a `2xx` whose link cannot be parsed is `PROVIDER_ERROR`, never "created"                                                                                                                                                    | 4     |
| A2.3  | `PATCH /payment_links/{id}` with `{ active: false }` → `{ linkId, active: false }`; if Wompi still reports the link active → `PROVIDER_ERROR` (the consumer must not stop watching a link that still takes payments); a `linkId` outside `[A-Za-z0-9_-]{1,64}` (`../transactions`, `a?b=1`, …) is refused before any path is built                                                                                                                                                                                                                                                                | 3     |
| A2.4  | Params `from_date`, `until_date`, `page=1`, `page_size=200`; each transaction comes back as `{ id, paymentLinkId, status, amountInCents, currency, createdAt, finalizedAt }` and the payer's email/name/phone never leave the provider; pages are read until `page × 200 ≥ total_results`; a window over 50 pages → `PROVIDER_ERROR` (`Wompi transaction window too large; narrow fromDate/untilDate`) with no partial list; `untilDate ≤ fromDate` → `PROVIDER_INVALID_INPUT` with no request                                                                                                    | 4     |
| A2.5  | `wompiProvider` registered in `PROVIDERS` (one line); `listTools()` is empty, yet each of the four tools is dispatched by name (never `PROVIDER_UNKNOWN_TOOL`); a rejected key → `PROVIDER_AUTH_EXPIRED` through the full call path; the repo-wide catalog, audience and parity tests pass with Wompi registered                                                                                                                                                                                                                                                                                  | 3     |

**Gate A2:** `npm run typecheck` clean · `npx vitest run` 673/673 (51 files) · Prettier clean on every touched file.

### Decisions taken while building A2

- **`unwrapWompi` now hands back `meta` next to `data`.** The listing needs Wompi's `meta.total_results` to know when to stop. The other tools ignore it. The A1.4 test now pins `meta` too.
- **The 50-page cap fails on the first page.** The contract says "at most 50 pages". `total_results` on page 1 already shows whether the window fits, so the tool refuses after **one** call instead of reading 49 pages it would throw away. Same outcome for the consumer, 49 fewer calls. The check runs on every page, so a total that grows while paginating is caught too.
- **The window check is a `.refine` on the input** (same pattern as Erbon's `checkOutDate > checkInDate`), so a bad window fails as `PROVIDER_INVALID_INPUT` in the core's validation, before the handler runs.
- **Statuses parsed as Wompi's set** (`APPROVED`, `DECLINED`, `PENDING`, `ERROR`, `VOIDED`). A status outside that set makes the page unparseable → `PROVIDER_ERROR`, instead of handing the consumer a status it cannot settle on.
- **Payer data is dropped by the parse, not by a deny-list.** The zod schema names only the fields settlement needs; everything else Wompi returns (`customer_email`, `customer_data`, `billing_data`, `payment_method`) is stripped. A test pins that the fixture's fake email never appears in the result. So `identityPolicy` stays omitted.

### Open items (A2)

- [x] **Logo.** `assets/wompi.svg` is Wompi's official isotype, taken verbatim from the brand file Sara supplied (`Wompi_LogoSecundario.svg`, 1920×1080 with the full wordmark) and cropped to the 35×35 square tile every other provider logo uses, on the brand green `#B0F2AE`. The wordmark would be unreadable at that size. The placeholder from A2.5 is gone.
- [ ] **`VOIDED` / `ERROR` were not observed in the sandbox** (only `APPROVED` and `DECLINED`). They come from Wompi's documented status set. Confirm with a real event when the webhook test runs.
