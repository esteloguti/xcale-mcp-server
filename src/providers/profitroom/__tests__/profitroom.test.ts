import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { RequestSpec } from '../../../core/auth/http-request';
import { ProviderErrorCode } from '../../../core/errors';
import type { RequestResult } from '../../../core/http';
import { createProfitroomClient } from '../client';

import { hotelKeyFrom, profitroomContext } from '../context';
import {
  availabilitySchema,
  calendarSchema,
  detailsSchema,
  offersSchema,
  roomsSchema,
} from '../schemas';

/** A raw engine response captured live on 2026-10-14 (contract §D). */
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, '..', '__fixtures__', `${name}.json`), 'utf8'));
}

// ---------------------------------------------------------------------------
// S1 — Booking-engine URL (CONTEXT.md): parsed, never fetched. Contract §B.
// ---------------------------------------------------------------------------

describe('booking-engine URL context', () => {
  it.each([
    ['https://booking.profitroom.com/es/hotellapausa', 'hotellapausa'],
    ['https://booking.profitroom.com/en/hotellapausa/', 'hotellapausa'],
    ['https://booking.profitroom.com/es/hotellapausa/home?currency=COP', 'hotellapausa'],
    ['https://booking.profitroom.com/pl/hotel-123', 'hotel-123'],
  ])('accepts %s and routes to hotel key %s', (bookingEngineUrl, key) => {
    const parsed = profitroomContext.safeParse({ bookingEngineUrl });
    expect(parsed.success).toBe(true);
    expect(hotelKeyFrom(bookingEngineUrl)).toBe(key);
  });

  it.each([
    ['plain http', 'http://booking.profitroom.com/es/hotellapausa'],
    ['another host', 'https://evil.com/es/hotellapausa'],
    ['a look-alike host', 'https://booking.profitroom.com.evil.com/es/hotellapausa'],
    ['userinfo', 'https://x@booking.profitroom.com/es/hotellapausa'],
    ['a port', 'https://booking.profitroom.com:8443/es/hotellapausa'],
    ['no locale segment', 'https://booking.profitroom.com/hotellapausa'],
    ['no hotel segment', 'https://booking.profitroom.com/es/'],
    ['an API path', 'https://booking.profitroom.com/api/hotellapausa/details'],
    ['not a URL', 'hotellapausa'],
  ])('rejects %s', (_case, bookingEngineUrl) => {
    expect(profitroomContext.safeParse({ bookingEngineUrl }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// S1 — wire schemas: the fields we use, shared with the drift probe. Contract §A, §E.
// ---------------------------------------------------------------------------

describe('engine response schemas', () => {
  it.each([
    ['details', detailsSchema],
    ['rooms', roomsSchema],
    ['offers', offersSchema],
    ['calendar', calendarSchema],
    ['availability', availabilitySchema],
    ['availability-child', availabilitySchema],
    ['availability-dropped-child', availabilitySchema],
  ] as const)('accepts the live %s response', (name, schema) => {
    const parsed = schema.safeParse(fixture(name));
    expect(parsed.error?.issues).toBeUndefined();
  });

  it('rejects a drifted availability response and names the field', () => {
    const drifted = structuredClone(fixture('availability')) as {
      proposals: { proposal: Record<string, unknown> }[];
    }[];
    const proposal = drifted[0]?.proposals[0]?.proposal as Record<string, unknown>;
    proposal.cost = proposal.price;
    delete proposal.price;

    const parsed = availabilitySchema.safeParse(drifted);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual([0, 'proposals', 0, 'proposal', 'price']);
  });
});

// ---------------------------------------------------------------------------
// S2 — client: fixed base, required header, fail-closed parsing, error remap, cache. Contract §A.1, §C.4, §C.5.
// ---------------------------------------------------------------------------

type Reply = RequestResult | ((spec: RequestSpec) => RequestResult);

/** The core's `ctx.request` seam, faked: records each spec and answers in order (last one repeats). */
function fakeRequest(...replies: Reply[]) {
  const calls: RequestSpec[] = [];
  const request = async (spec: RequestSpec): Promise<RequestResult> => {
    calls.push(spec);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)] as Reply;
    return typeof reply === 'function' ? reply(spec) : reply;
  };
  return { calls, request };
}

const okReply = (data: unknown): RequestResult => ({ ok: true, status: 200, data });

describe('profitroom client', () => {
  it('builds every request from the fixed API base, with the engine header and the locale', async () => {
    const { calls, request } = fakeRequest(okReply(fixture('rooms')));
    const client = createProfitroomClient();

    const r = await client.get(request, 'hotellapausa', 'rooms', roomsSchema, { locale: 'es' });

    expect(r.ok).toBe(true);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('https://booking.profitroom.com/api/hotellapausa/rooms?lang=es');
    expect(calls[0]?.headers).toEqual({ 'x-requested-with': 'XMLHttpRequest' });
  });

  it('fails closed on a drifted response: PROVIDER_ERROR naming the endpoint and field, never the data', async () => {
    const drifted = structuredClone(fixture('calendar')) as { dates: Record<string, unknown>[] };
    delete drifted.dates[0]?.minLOS;
    const { request } = fakeRequest(okReply(drifted));

    const r = await createProfitroomClient().get(
      request,
      'hotellapausa',
      'calendar',
      calendarSchema,
    );

    expect(r).toEqual({
      ok: false,
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: 'unexpected response from Profitroom (calendar: dates.0.minLOS Required)',
    });
  });

  const failed = (status: number, errorCode: ProviderErrorCode, body = ''): RequestResult => ({
    ok: false,
    status,
    errorCode,
    body,
  });

  it.each([
    [
      '401 → unavailable, not a reconnect (nothing to reconnect)',
      failed(401, ProviderErrorCode.AUTH_EXPIRED),
      ProviderErrorCode.PROVIDER_UNAVAILABLE,
    ],
    [
      '403 → unavailable (we were blocked)',
      failed(403, ProviderErrorCode.AUTH_EXPIRED),
      ProviderErrorCode.PROVIDER_UNAVAILABLE,
    ],
    [
      '404 site_not_found → invalid input (the URL names no hotel)',
      failed(404, ProviderErrorCode.PROVIDER_ERROR, JSON.stringify(fixture('site-not-found'))),
      ProviderErrorCode.INVALID_INPUT,
    ],
    [
      '422 → invalid input',
      failed(
        422,
        ProviderErrorCode.INVALID_INPUT,
        JSON.stringify(fixture('calendar-missing-params')),
      ),
      ProviderErrorCode.INVALID_INPUT,
    ],
    [
      '429 → rate limited',
      failed(429, ProviderErrorCode.RATE_LIMITED),
      ProviderErrorCode.RATE_LIMITED,
    ],
    [
      '503 → unavailable',
      failed(503, ProviderErrorCode.PROVIDER_UNAVAILABLE),
      ProviderErrorCode.PROVIDER_UNAVAILABLE,
    ],
  ])('maps %s', async (_case, reply, code) => {
    const { request } = fakeRequest(reply);
    const r = await createProfitroomClient().get(request, 'hotellapausa', 'details', detailsSchema);
    expect(r).toMatchObject({ ok: false, code });
  });

  it('reports a timeout or network failure as unavailable, without a fake status', async () => {
    const { request } = fakeRequest(failed(0, ProviderErrorCode.PROVIDER_UNAVAILABLE, 'aborted'));
    const r = await createProfitroomClient().get(request, 'hotellapausa', 'details', detailsSchema);
    expect(r).toEqual({
      ok: false,
      code: ProviderErrorCode.PROVIDER_UNAVAILABLE,
      message: 'Profitroom did not answer the details request',
    });
  });

  describe('static-resource cache (15 min, per hotel and locale)', () => {
    const MIN = 60_000;
    function clock(start = 0) {
      let t = start;
      return { now: () => t, advance: (ms: number) => (t += ms) };
    }

    it('serves details, rooms and offers from memory within 15 minutes', async () => {
      const c = clock();
      const { calls, request } = fakeRequest(okReply(fixture('rooms')));
      const client = createProfitroomClient({ now: c.now });

      await client.get(request, 'hotellapausa', 'rooms', roomsSchema, { locale: 'es' });
      c.advance(14 * MIN);
      const again = await client.get(request, 'hotellapausa', 'rooms', roomsSchema, {
        locale: 'es',
      });

      expect(again.ok).toBe(true);
      expect(calls).toHaveLength(1);
    });

    it('asks Profitroom again after 15 minutes, for another locale, or for another hotel', async () => {
      const c = clock();
      const { calls, request } = fakeRequest(okReply(fixture('rooms')));
      const client = createProfitroomClient({ now: c.now });

      await client.get(request, 'hotellapausa', 'rooms', roomsSchema, { locale: 'es' });
      await client.get(request, 'hotellapausa', 'rooms', roomsSchema, { locale: 'en' });
      await client.get(request, 'otherhotel', 'rooms', roomsSchema, { locale: 'es' });
      c.advance(15 * MIN);
      await client.get(request, 'hotellapausa', 'rooms', roomsSchema, { locale: 'es' });

      expect(calls).toHaveLength(4);
    });

    it('never caches availability or the calendar — prices and nights are always live', async () => {
      const { calls, request } = fakeRequest(okReply(fixture('availability')));
      const client = createProfitroomClient();
      const query = { checkIn: '2026-10-23', checkOut: '2026-10-25', 'occupancy[0][adults]': '2' };

      await client.get(request, 'hotellapausa', 'availability', availabilitySchema, { query });
      await client.get(request, 'hotellapausa', 'availability', availabilitySchema, { query });

      expect(calls).toHaveLength(2);
    });

    it('does not cache a failure', async () => {
      const { calls, request } = fakeRequest(
        failed(503, ProviderErrorCode.PROVIDER_UNAVAILABLE),
        okReply(fixture('details')),
      );
      const client = createProfitroomClient();

      const first = await client.get(request, 'hotellapausa', 'details', detailsSchema);
      const second = await client.get(request, 'hotellapausa', 'details', detailsSchema);

      expect(first.ok).toBe(false);
      expect(second.ok).toBe(true);
      expect(calls).toHaveLength(2);
    });

    it('invalidate(hotel) drops the cached resources of that hotel', async () => {
      const { calls, request } = fakeRequest(okReply(fixture('rooms')));
      const client = createProfitroomClient();

      await client.get(request, 'hotellapausa', 'rooms', roomsSchema, { locale: 'es' });
      client.invalidate('hotellapausa');
      await client.get(request, 'hotellapausa', 'rooms', roomsSchema, { locale: 'es' });

      expect(calls).toHaveLength(2);
    });
  });
});
