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
