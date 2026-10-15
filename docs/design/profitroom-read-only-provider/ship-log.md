# Profitroom Provider — Ship Log

- **Status:** pre-ship — built on `feat/implementation-profitroom-provider` (on top of the docs PR
  #143), not yet merged into `dev`. Tracking: #142, epic `xcale-backend#1598`.
- **Released to prod:** not yet
- **Release order:** deploy this **before** `xcale-backend#1599` goes live. The backend's Profitroom
  booking adapter calls `get_stay_prices`, and the connect flow needs the probe and the `hotelKey`
  discovery. No new env var: the provider has no credential (auth `none`).
- **Related:** `feature-design.md` · `api-contract.md` (§B.1 connect support) ·
  `implementation-plan.md` (build logs §0.5, §1.8, §1.9) · ADR `credential-less-provider-auth` ·
  ADR 0009 (fidelity over unification) · ADR 0013 (control-plane tools) · backend
  `docs/design/profitroom-booking/` and its `qa-findings.md`.
- **Pairs with:** N/A — no frontend half (the backend's connect descriptor drives the generic form).

## Summary

Profitroom (La Pausa Hotelbistró, first tenant) as a read-only, **credential-less** provider over
the hotel's public booking-engine API (`https://booking.profitroom.com/api/{hotelKey}/`). The
connection holds only `bookingEngineUrl` + the discovered `hotelKey`. Field names stay Profitroom's
own (ADR 0009). Nothing is ever reserved: the backend sends the guest a booking-engine link.

## What shipped

| Tool                                                                                            | Agent menu      | Purpose                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `get_hotel`, `list_room_types`, `list_rates`, `get_availability_calendar`, `check_availability` | ✅              | Hotel catalog reads, money-free                                                                                         |
| `get_stay_prices`                                                                               | ❌ controlPlane | Price for one room + party, `taxesPresentationMode`/`taxesIncluded`, child-age checks, re-split detection, booking link |

Also: auth `none` in the core (`ProviderAuthDescriptor`, materializer, conformance), the connect
support (`connectionProbe`, `contextDiscovery` of `hotelKey`, `accountContextKeys`), a 15-minute
catalog cache, and a daily drift probe (`scripts/profitroom-drift.ts` +
`.github/workflows/profitroom-drift.yml`). `schemaVersion` 2026-10-15, `providerVersion` 0.2.0.

## Ship Log

### Migrations

- N/A (no migration, no new env var)

### Manual UI / QA (dev period)

- 2026-10-15 ran this branch as the local gateway for the backend QA (`xcale-backend`
  `qa/scenarios/profitroom-booking.md`) against the live La Pausa engine: connect by URL (probe +
  discovery), catalog reads, live prices with children by age, an 8-adult party detected as
  re-split (the engine silently answered one group of 4 — caught by the occupancy comparison), and
  a price question with the gateway down (no figure given). Every scenario passed. Details:
  backend `docs/design/profitroom-booking/qa-findings.md`.

### Feature flags / config

- ⬜ Enable the drift workflow on GitHub once this is on `dev` (it needs no secret).

### Deploy verification (prod)

- [ ] prod gateway lists `profitroom` with `connectionProbe` and `contextDiscovery` — ⬜ pending

## Reviews

- ⬜ `/code-review` and `/security-review` before the PR.

## Known gaps at ship

- ⬜ Provider logo (`logoUrl`) — none yet.
- ⬜ Rate limit on the engine: no documented limit; the 15-minute cache keeps calls low. Watch the
  drift workflow and the gateway logs after La Pausa goes live.
- The API is Profitroom's internal booking-engine API, not a public contract: the drift probe is the
  early warning if its shapes change.
