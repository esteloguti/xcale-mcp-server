import type { Details } from './schemas';

export interface BookingLinkArgs {
  readonly locale: string;
  readonly hotelKey: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly adults: number;
  readonly childrenAges: readonly number[];
  readonly currency: string;
  readonly RoomID: number;
  readonly OfferID: number;
  readonly details: Details;
}

/**
 * The booking-engine page with the stay already filled in (contract §A.8, Observed in the browser):
 * the guest lands on the quoted search and pays there. Built from a fixed origin — never from the
 * connection's URL.
 *
 * Children depend on the hotel's picker: the classic one (`enabledNewChildrenOccupancyPicker: false`,
 * La Pausa) takes `r1_child{minAge}-{maxAge}={count}` per child age band (verified: "2 adultos • 1
 * niño"); the new one takes `r1_children_age={a},{b}` (Inferred from the engine bundle).
 * `room-id`/`offer-id` are accepted by the engine; whether they pre-select is unverified.
 */
export function buildBookingUrl(a: BookingLinkArgs): string {
  const params: [string, string][] = [
    ['check-in', a.checkIn],
    ['check-out', a.checkOut],
    ['r1_adults', String(a.adults)],
    ...childrenParams(a.details, a.childrenAges),
    ['currency', a.currency],
    ['room-id', String(a.RoomID)],
    ['offer-id', String(a.OfferID)],
  ];
  const qs = new URLSearchParams(params).toString();
  return `https://booking.profitroom.com/${a.locale}/${encodeURIComponent(a.hotelKey)}/pricelist/rooms/?${qs}`;
}

function childrenParams(details: Details, ages: readonly number[]): [string, string][] {
  if (ages.length === 0) return [];
  if (details.enabledNewChildrenOccupancyPicker) {
    return [['r1_children_age', ages.join(',')]];
  }
  // Ages were already checked to sit inside the hotel's child band (`personTypes` C) — one band.
  const band = details.personTypes.find((p) => p.type === 'C');
  return [[`r1_child${band?.minAge ?? 0}-${band?.maxAge ?? 0}`, String(ages.length)]];
}
