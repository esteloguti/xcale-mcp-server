# Wompi Provider — Implementation Plan

> **Inputs**: [`feature-design.md`](./feature-design.md) · [`api-contract.md`](./api-contract.md) · [`grill-notes.md`](./grill-notes.md) · [`sandbox-evidence.md`](./sandbox-evidence.md)
> **Issue**: matesjara/xcale-mcp-server#159 · **Branch**: `feat/159-wompi-provider` (from `dev` @ `55f2cba`)
> **Status**: Draft · **Last updated**: 2026-10-22
>
> Symbols and intent, **no bodies**. Every change to an existing file is anchored to a real `file:line` on `dev` @ `55f2cba`.

## Meta

A new provider, `wompi`, following the `add-provider` pattern of `src/providers/toteat/`
(`auth`/`context`/`manifest`/`client`/`errors`/`tools`/`provider`/`index` + `__fixtures__`/`__tests__`).

**Shape of the change:**

- **No core change.** The only new idea is choosing the base URL from call context (`ctx.metadata.environment`), the way WooCommerce uses `ctx.storeUrl`.
- **Footprint:** one new folder plus one line in `src/providers/index.ts`.

**"Done" means:**

- The four tools are callable and absent from `tools/list`.
- Each Wompi response from the spike is covered by a fixture test.
- A Wompi error body containing a key never reaches an outcome or a log.
- `tsc`, Prettier and Vitest are green.

**Solo build**, under the fan-out threshold: two slices, about 10 files.

## Target tree

```
src/providers/
├── index.ts                         # MOD — import + one PROVIDERS entry
└── wompi/                           # NEW
    ├── auth.ts                      # NEW — bearer descriptor
    ├── context.ts                   # NEW — zod context { publicKey, environment? }
    ├── manifest.ts                  # NEW — slug, connectionProbe, accountContextKeys
    ├── client.ts                    # NEW — base URL by environment; get/post/patch over the core request
    ├── errors.ts                    # NEW — unwrapWompi: status → ProviderErrorCode, never the body
    ├── tools.ts                     # NEW — 4 controlPlane tools
    ├── provider.ts                  # NEW — createWompiProvider / wompiProvider
    ├── index.ts                     # NEW
    ├── __fixtures__/                # NEW — api-contract §3
    └── __tests__/
        ├── errors.test.ts           # NEW — mapping + redaction
        └── wompi.test.ts            # NEW — tools against fakeFetch
assets/wompi.(svg|png)               # NEW — logo, if the catalog needs one
```

## Anchors (existing code read on `dev` @ `55f2cba`)

| Seam                        | File:line                                                                                     | Use                                   |
| :-------------------------- | :-------------------------------------------------------------------------------------------- | :------------------------------------ |
| Provider list               | `src/providers/index.ts:18-27` (`PROVIDERS`)                                                  | Add `wompiProvider`                   |
| Factory                     | `src/core/provider-factory.ts:11` (`ProviderSpec`), `:39` (`createProvider`)                  | Assemble                              |
| Bearer descriptor           | `src/core/provider-port.ts:39-60`; example `src/providers/cloudbeds/auth.ts:41-47`            | `wompiAuth`                           |
| Probe + account keys        | `src/core/provider-port.ts:176-179`, `:193`; example `src/providers/toteat/manifest.ts:18-33` | `wompiManifest`                       |
| `controlPlane`              | `src/core/tool.ts:107`; example `src/providers/toteat/tools.ts:148-169`                       | All four tools                        |
| Tool factory / outcomes     | `src/core/tool.ts:16,20` (`ok`, `err`), `:129` (`toolFactory`)                                | Tools                                 |
| Result mapping              | `src/protocol/result-mapping.ts:10-28`                                                        | `structuredContent` shape (no change) |
| Error codes                 | `src/core/errors.ts:6-15`                                                                     | Mapping                               |
| Client pattern              | `src/providers/toteat/client.ts:15,21,57-58`                                                  | `createWompiClient`                   |
| Per-call base URL precedent | `src/providers/woocommerce/client.ts:46-70`                                                   | Base URL from context                 |
| Error unwrap pattern        | `src/providers/toteat/errors.ts:120` (`unwrapToteat`)                                         | `unwrapWompi`                         |
| Core redaction (query only) | `src/core/http.ts:47`                                                                         | Reason for our own redaction          |
| Tests                       | `src/providers/toteat/__tests__/toteat.test.ts:19-35` (`CTX`, `fakeFetch`)                    | Same doubles                          |

## Per-file changes

| File / symbol                                              | Kind | Signature                                                                                                                                                                                                   | Intent                                                                                                                               |
| :--------------------------------------------------------- | :--- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| `wompi/auth.ts` `wompiAuth`                                | NEW  | `ProviderAuthDescriptor`                                                                                                                                                                                    | Bearer, one field `private_key`, header, forwarded.                                                                                  |
| `wompi/context.ts` `wompiContext`, `WompiContext`          | NEW  | `z.object({ publicKey, environment? }).strict()`                                                                                                                                                            | Context; `environment` optional (contract §0).                                                                                       |
| `wompi/manifest.ts` `wompiManifest`                        | NEW  | `ProviderManifest`                                                                                                                                                                                          | `slug: 'wompi'`, `connectionProbe: { tool: 'mcp_wompi_check_credentials' }`, `accountContextKeys: ['publicKey']`.                    |
| `wompi/client.ts` `createWompiClient`, `WompiClient`       | NEW  | `createWompiClient(deps: { baseUrls?: { sandbox: string; production: string } }): WompiClient` with `get(path, request, ctx, params?)`, `post(path, request, ctx, body)`, `patch(path, request, ctx, body)` | Picks the base URL from `ctx.environment`; missing → returns a typed failure without calling.                                        |
| `wompi/errors.ts` `unwrapWompi`                            | NEW  | `unwrapWompi(res: RequestResult, operation: string): Unwrapped`                                                                                                                                             | Status → `ProviderErrorCode` (contract §2); fixed own message; never reads `reason`/`messages` into the outcome.                     |
| `wompi/tools.ts` `buildWompiTools`                         | NEW  | `buildWompiTools(client: WompiClient): ReadonlyArray<ToolDefinition<any, WompiContext>>`                                                                                                                    | The four tools of contract §1; `list_transactions` paginates at 200 and trims fields; `create_payment_link` builds the checkout URL. |
| `wompi/provider.ts` `createWompiProvider`, `wompiProvider` | NEW  | `createWompiProvider(deps?: { fetchImpl?: FetchLike; baseUrls?: … }): IProvider`                                                                                                                            | `createProvider({ manifest, auth, metadataSchema: wompiContext, tools, fetchImpl })`.                                                |
| `src/providers/index.ts`                                   | MOD  | `PROVIDERS` (`:18-27`)                                                                                                                                                                                      | One import + one entry.                                                                                                              |

## Slices

| #   | Slice                                          | Owns                                                                                                                | Depends on | DoD                                                                                                                                                                                                             |
| :-- | :--------------------------------------------- | :------------------------------------------------------------------------------------------------------------------ | :--------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Client, context, auth, errors (with redaction) | `auth.ts`, `context.ts`, `client.ts`, `errors.ts`, `__tests__/errors.test.ts`, error fixtures                       | —          | Tests: each status maps to its code; an error body carrying a fake key never appears in the outcome or the message; missing `environment` fails closed without a fetch.                                         |
| A2  | Tools, manifest, provider, registration        | `tools.ts`, `manifest.ts`, `provider.ts`, `index.ts`, `src/providers/index.ts`, `__tests__/wompi.test.ts`, fixtures | A1         | Tests: request shapes (method, path, body, `Authorization`, base URL per environment); outcomes per contract; pagination stops at `total_results`; payer data dropped; the four tools absent from `tools/list`. |

- [ ] A1
- [ ] A2

## Test strategy

- Vitest with the toteat-style `fakeFetch` (records URL, method, headers and body) and fixtures from the spike.
- `CTX = { credential: { secret: new SecretString('prv_test_FAKE') }, metadata: { publicKey: 'pub_test_FAKE', environment: 'sandbox' } }`.
- Commands: `npm test`, `npm run typecheck`, Prettier check.
- Optional, after merge: `mcp-contract-qa` against `sandbox.wompi.co` with the Doppler sandbox keys (Mateo's personal sandbox account, approved 2026-10-22).

## Definition of done

- [ ] A1 and A2 ticked.
- [ ] `npm test` · `npm run typecheck` · Prettier green.
- [ ] Redaction test present and green.
- [ ] PR to `dev` referencing #159 and epic matesjara/xcale-backend#1070.

## Risks

| Risk                                                     | Mitigation                                                          |
| :------------------------------------------------------- | :------------------------------------------------------------------ |
| Key leak through a Wompi error body                      | Own messages only; dedicated test.                                  |
| The core's generated connect form asks for `environment` | It is optional in the schema (contract §0); the consumer writes it. |
