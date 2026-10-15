import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

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
