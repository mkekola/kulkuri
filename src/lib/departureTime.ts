// en-GB with hour12 off reliably gives "23:45" - locale-formatted time
// strings can otherwise use a period instead of a colon.
const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Europe/Helsinki',
});

// Departures under an hour away read as a countdown; anything further out
// reads as a clock time instead, since a raw minute count stops being a
// useful unit much past that.
export function formatDepartureCountdown(departureAt: number, now: number): string {
  const minutes = Math.round((departureAt - now) / 60_000);
  if (minutes <= 0) return 'nyt';
  if (minutes < 60) return `${minutes} min`;
  return clockFormatter.format(departureAt);
}
