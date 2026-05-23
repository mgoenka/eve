// Reservation deep-link builder. None of OpenTable / Resy / Tock have a
// public booking API for third-party clients, but every one of them
// supports a search URL with the restaurant name + city + party size +
// date + time pre-filled. We send the user there with one click, the
// page lands with the right inputs, the user confirms, the booking is
// theirs. This is the right move from a UX standpoint until we ink
// individual partnership APIs.

export type ReservationPlatform = 'opentable' | 'resy' | 'tock';

export interface ReservationLinkInput {
  restaurantName: string;
  city: string;            // e.g. "Mountain View, CA"
  party?: number;          // 2 default
  whenISO?: string;        // YYYY-MM-DD
  startTime?: string;      // 24-hour "HH:MM"
}

function isoDate(d?: string): string {
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return new Date().toISOString().slice(0, 10);
}

function timeOrDefault(t?: string): string {
  if (t && /^\d{1,2}:\d{2}$/.test(t)) {
    const [hh, mm] = t.split(':');
    return `${hh.padStart(2, '0')}:${mm}`;
  }
  return '19:30';
}

export function openTableUrl(input: ReservationLinkInput): string {
  const date = isoDate(input.whenISO);
  const time = timeOrDefault(input.startTime);
  const dateTime = `${date}T${time}`;
  const term = encodeURIComponent(`${input.restaurantName} ${input.city}`.trim());
  const partySize = String(input.party || 2);
  return `https://www.opentable.com/s?term=${term}&dateTime=${encodeURIComponent(dateTime)}&covers=${partySize}`;
}

export function resyUrl(input: ReservationLinkInput): string {
  // Resy doesn't accept date / time in the URL but it accepts query + venue
  // search. Send them to the search page; the venue page itself shows the
  // date picker.
  const q = encodeURIComponent(`${input.restaurantName} ${input.city}`.trim());
  return `https://resy.com/cities/all/search?query=${q}`;
}

export function tockUrl(input: ReservationLinkInput): string {
  // Tock's search supports a query string; venue page handles the booking.
  const q = encodeURIComponent(`${input.restaurantName} ${input.city}`.trim());
  return `https://www.exploretock.com/search?query=${q}`;
}

export interface ReservationLink {
  platform: ReservationPlatform;
  label: string;
  url: string;
}

// Build all three platform links. Stop cards can render the user's
// preferred one (defaults to OpenTable since it has the most coverage and
// our deepest pre-fill).
export function buildReservationLinks(input: ReservationLinkInput): ReservationLink[] {
  return [
    { platform: 'opentable', label: 'OpenTable', url: openTableUrl(input) },
    { platform: 'resy', label: 'Resy', url: resyUrl(input) },
    { platform: 'tock', label: 'Tock', url: tockUrl(input) },
  ];
}
