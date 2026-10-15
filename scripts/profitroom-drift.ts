/**
 * Profitroom drift probe — does the live booking-engine API still have the shape the provider reads?
 *
 * Profitroom's engine API is internal, not a published contract (ADR credential-less-provider-auth), so
 * it can change without notice. The provider already fails closed on a changed response; this probe is
 * the early warning. It calls the five endpoints the provider uses on a real hotel and parses each with
 * the provider's OWN exported schemas (`src/providers/profitroom/schemas.ts`) — one definition of "the
 * shape we depend on", shared by runtime and probe, so the two can never disagree.
 *
 *   npx tsx scripts/profitroom-drift.ts   # exit 0 = no drift, exit 1 = drift or engine down
 *
 * Run daily by `.github/workflows/profitroom-drift.yml`, which opens an issue on failure.
 * See docs/design/profitroom-read-only-provider/api-contract.md §E.
 */
import type { z } from 'zod';

import {
  availabilitySchema,
  calendarSchema,
  detailsSchema,
  offersSchema,
  roomsSchema,
} from '../src/providers/profitroom/schemas';

/** The first Profitroom tenant's public engine (La Pausa) — public data, no credential. */
const HOTEL_KEY = 'hotellapausa';
const API_BASE = 'https://booking.profitroom.com/api/';
const DAY_MS = 86_400_000;

export interface DriftCheck {
  readonly resource: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface DriftReport {
  readonly ok: boolean;
  readonly checks: readonly DriftCheck[];
}

export interface DriftProbeOptions {
  readonly fetchImpl?: typeof fetch;
  /** Today, `YYYY-MM-DD` (UTC). The probe looks 30 days ahead so the dates are always bookable. */
  readonly today?: string;
}

export async function runDriftProbe(opts: DriftProbeOptions = {}): Promise<DriftReport> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const from = addDays(today, 30);

  const targets: [string, Record<string, string>, z.ZodTypeAny][] = [
    ['details', {}, detailsSchema],
    ['rooms', {}, roomsSchema],
    ['offers', { status: '1' }, offersSchema],
    ['calendar', { from, to: addDays(from, 14) }, calendarSchema],
    [
      'availability',
      { checkIn: from, checkOut: addDays(from, 2), 'occupancy[0][adults]': '2' },
      availabilitySchema,
    ],
  ];

  const checks: DriftCheck[] = [];
  for (const [resource, query, schema] of targets) {
    checks.push(await check(fetchImpl, resource, query, schema));
  }
  return { ok: checks.every((c) => c.ok), checks };
}

async function check(
  fetchImpl: typeof fetch,
  resource: string,
  query: Record<string, string>,
  schema: z.ZodTypeAny,
): Promise<DriftCheck> {
  const qs = new URLSearchParams(query).toString();
  const url = `${API_BASE}${HOTEL_KEY}/${resource}${qs ? `?${qs}` : ''}`;
  try {
    const res = await fetchImpl(url, {
      headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    });
    if (!res.ok) return { resource, ok: false, detail: `HTTP ${res.status}` };
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        resource,
        ok: false,
        detail: issue ? `${issue.path.join('.')}: ${issue.message}` : 'unknown shape',
      };
    }
    return { resource, ok: true, detail: 'matches' };
  } catch (e) {
    return { resource, ok: false, detail: e instanceof Error ? e.message : 'request failed' };
  }
}

function addDays(isoDay: string, days: number): string {
  return new Date(Date.parse(`${isoDay}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const report = await runDriftProbe();
  for (const c of report.checks) {
    console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.resource.padEnd(13)} ${c.detail}`);
  }
  if (!report.ok) {
    console.error(
      '\nProfitroom drift detected — the provider is failing closed for the changed endpoint(s).',
    );
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('profitroom-drift.ts')) void main();
