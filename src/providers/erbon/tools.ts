import { z } from 'zod';

import { toolFactory, type ToolDefinition } from '../../core/tool';
import type { ErbonClient } from './client';
import type { ErbonContext } from './context';
import { unwrapErbon } from './errors';
import { SLUG } from './manifest';

const tool = toolFactory<ErbonContext>();

/** No-argument input — the reference reads that take no filter (hotelID rides the call context). */
const noArgs = z.object({}).strict();

/** Erbon takes stay dates as ISO calendar dates, `YYYY-MM-DD`, in request headers (Observed). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO calendar date (YYYY-MM-DD)');

/**
 * The curated Erbon menu — money-free reads only. `hotelID` comes from the call context, never a tool
 * arg. Data is returned VERBATIM (Fidelity over Unification); no canonical DTO. Erbon filter params
 * travel in HEADERS, not the query string.
 *
 * The money read (`get_rate_prices`) is added in S3 as a `controlPlane` tool — routable by the backend
 * but withdrawn from this menu, so the agent can never narrate a raw, pre-tax price (AD-2). See
 * `docs/design/erbon-read-only-provider/implementation-plan.md`.
 */
export function buildErbonTools(
  client: ErbonClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
): ReadonlyArray<ToolDefinition<any, ErbonContext>> {
  return [
    tool({
      name: `mcp_${SLUG}_check_availability`,
      description:
        'Check room availability at the connected Erbon hotel for a stay window. Takes `checkinDate` ' +
        'and `checkoutDate` (YYYY-MM-DD). Returns a flat array (verbatim) of rows — each `{ date, ' +
        'roomTypeDescription, statusAvailability }` — where `statusAvailability` is the count of that ' +
        'room type free on that date. Does NOT return prices; use it to see what is available, then ' +
        'quote through the booking flow. The hotel is the connected one (no hotel id argument).',
      input: z.object({ checkinDate: isoDate, checkoutDate: isoDate }).strict(),
      handler: async (args, ctx) =>
        unwrapErbon(
          await client.get('availability', ctx.request, ctx.metadata, {
            checkinDate: args.checkinDate,
            checkoutDate: args.checkoutDate,
          }),
          'check availability',
        ),
    }),
    tool({
      name: `mcp_${SLUG}_list_room_types`,
      description:
        'List the room types at the connected Erbon hotel. Returns a flat array (verbatim); each ' +
        'carries `id`, `code`, `description`, `minPax`, `maxPax`, `roomCount`. Use `description` to ' +
        'join with check_availability rows, and min/max pax to match a party size.',
      input: noArgs,
      handler: async (_args, ctx) =>
        unwrapErbon(
          await client.get('mapping/roomtype', ctx.request, ctx.metadata),
          'list room types',
        ),
    }),
    tool({
      name: `mcp_${SLUG}_list_rates`,
      description:
        'List the rate plans at the connected Erbon hotel. Returns a flat array (verbatim); each ' +
        'carries `id`, `code`, `description` and meal-plan flags `allowRO`/`allowBB`/`allowHB`/' +
        '`allowFB`/`allowAI` (Room Only / Bed & Breakfast / Half / Full board / All Inclusive). Rate ' +
        'definitions only — not prices.',
      input: noArgs,
      handler: async (_args, ctx) =>
        unwrapErbon(await client.get('mapping/rates', ctx.request, ctx.metadata), 'list rates'),
    }),
    tool({
      name: `mcp_${SLUG}_get_hotel`,
      description:
        'Get the connected Erbon hotel profile (name, contact, currency), verbatim. Use it for the ' +
        'hotel name and contact details when handing a guest off to the hotel to complete a booking.',
      input: noArgs,
      handler: async (_args, ctx) =>
        unwrapErbon(await client.get('', ctx.request, ctx.metadata), 'get hotel'),
    }),
    tool({
      // BACKEND-ONLY (AD-2, the money guard): `controlPlane: true` keeps this OUT of `listTools()` — the
      // agent's menu — while it stays in `routableToolNames()`, callable by the backend. It is the only
      // Erbon read that returns money; the backend `erbon-stay-truth` adapter consumes it to compose a
      // tax-correct StayQuote. Off the menu, the agent can never narrate a raw, pre-tax price.
      name: `mcp_${SLUG}_get_rate_prices`,
      description:
        'BACKEND-ONLY (withdrawn from the agent menu). Rate prices for one rate + room type over a date ' +
        'range at the connected Erbon hotel. Consumed by the backend to compose a tax-correct quote — ' +
        'the agent never narrates a raw price. Returns a flat array (verbatim); params travel in headers.',
      controlPlane: true,
      input: z
        .object({
          dateFrom: isoDate,
          dateTo: isoDate,
          idRate: z.number().int().positive(),
          idRoomType: z.number().int().positive(),
        })
        .strict(),
      handler: async (args, ctx) =>
        unwrapErbon(
          await client.get('mapping/rateprices', ctx.request, ctx.metadata, {
            dateFrom: args.dateFrom,
            dateTo: args.dateTo,
            idRate: String(args.idRate),
            idRoomType: String(args.idRoomType),
          }),
          'get rate prices',
        ),
    }),
  ];
}
