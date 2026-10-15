import { z } from 'zod';

import { err, ok, toolFactory, type ToolDefinition } from '../../core/tool';
import type { ClientResult, ProfitroomClient, SendRequest } from './client';
import { hotelKeyFrom, type ProfitroomContext } from './context';
import { resolveLocale, toHotel, toOffer, toRoom } from './mappers';
import { SLUG } from './manifest';
import { type Details, detailsSchema, offersSchema, roomsSchema } from './schemas';

const tool = toolFactory<ProfitroomContext>();

/** Active offers only — the engine's own page asks `offers?status=1` (Observed). */
const ACTIVE_OFFERS = { query: { status: '1' } } as const;

/** A guest-facing language code; checked against the hotel's live locales per call. */
const locale = z
  .string()
  .regex(/^[a-z]{2}$/, 'Use a two-letter language code, e.g. es')
  .optional()
  .describe("Two-letter language for names and descriptions; defaults to the hotel's language.");

/**
 * The Profitroom menu (contract §C.1): money-free reads over the hotel's public booking engine. The
 * hotel comes from the call context (`bookingEngineUrl`), never from a tool argument. Every tool is
 * guest-safe (`audience: 'customer'`) and read-only.
 */
export function buildProfitroomTools(
  client: ProfitroomClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
): ReadonlyArray<ToolDefinition<any, ProfitroomContext>> {
  return [
    tool({
      name: `mcp_${SLUG}_get_hotel`,
      description:
        "Get the connected hotel's profile from its Profitroom booking engine: name, description, " +
        'currency, time zone, languages, address, guest types (child age range) and check-in/check-out ' +
        'times, plus its public booking-engine address. No prices.',
      input: z.object({ locale }).strict(),
      readOnly: true,
      audience: 'customer',
      handler: async (args, ctx) => {
        const hotel = await loadHotel(client, ctx.request, ctx.metadata, args.locale);
        if (!hotel.ok) return err(hotel.code, hotel.message);
        return ok(toHotel(hotel.data.details, hotel.data.locale, hotel.data.hotelKey));
      },
    }),
    tool({
      name: `mcp_${SLUG}_list_room_types`,
      description:
        'List the room types of the connected Profitroom hotel: name, description, beds, view, area, ' +
        'occupancy limits (`limits.max.occupancy`: adults and children by age range), total rooms ' +
        'and the rate ids (`offerIds`) sold for each. No prices and no availability.',
      input: z.object({ locale }).strict(),
      readOnly: true,
      audience: 'customer',
      handler: async (args, ctx) => {
        const hotel = await loadHotel(client, ctx.request, ctx.metadata, args.locale);
        if (!hotel.ok) return err(hotel.code, hotel.message);
        const { hotelKey, details, locale: loc } = hotel.data;
        const rooms = await client.get(ctx.request, hotelKey, 'rooms', roomsSchema);
        if (!rooms.ok) return err(rooms.code, rooms.message);
        return ok(rooms.data.map((room) => toRoom(room, loc, details.defaultLocale)));
      },
    }),
    tool({
      name: `mcp_${SLUG}_list_rates`,
      description:
        'List the rates (offers) of the connected Profitroom hotel: name, description (what the rate ' +
        'includes, e.g. breakfast), the room type ids it applies to (`roomIds`), its payment and ' +
        'cancellation profiles (`profiles`: deposit %, `cancelTime`/`cancelUnit` before arrival, when ' +
        'the rest is paid) and its date restrictions. Definitions only — no prices.',
      input: z.object({ locale }).strict(),
      readOnly: true,
      audience: 'customer',
      handler: async (args, ctx) => {
        const hotel = await loadHotel(client, ctx.request, ctx.metadata, args.locale);
        if (!hotel.ok) return err(hotel.code, hotel.message);
        const { hotelKey, details, locale: loc } = hotel.data;
        const offers = await client.get(
          ctx.request,
          hotelKey,
          'offers',
          offersSchema,
          ACTIVE_OFFERS,
        );
        if (!offers.ok) return err(offers.code, offers.message);
        return ok(offers.data.map((offer) => toOffer(offer, loc, details.defaultLocale)));
      },
    }),
  ];
}

interface HotelScope {
  readonly hotelKey: string;
  readonly details: Details;
  readonly locale: string;
}

/** Every tool starts here: the hotel key from the context, its (cached) details, the call's locale. */
async function loadHotel(
  client: ProfitroomClient,
  request: SendRequest,
  metadata: ProfitroomContext,
  requestedLocale: string | undefined,
): Promise<ClientResult<HotelScope>> {
  const hotelKey = hotelKeyFrom(metadata.bookingEngineUrl);
  const details = await client.get(request, hotelKey, 'details', detailsSchema);
  if (!details.ok) return details;
  const loc = resolveLocale(details.data, requestedLocale);
  if (!loc.ok) return loc;
  return { ok: true, data: { hotelKey, details: details.data, locale: loc.data } };
}
