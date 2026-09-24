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

// HSL's own apps don't flag anything within about a minute either way as
// late/early - reporting it down to the second would just be noise from
// ordinary GPS/traffic-light jitter, not a real schedule deviation.
const ON_TIME_TOLERANCE_S = 60;

// null means no delay data at all (a departure with no live estimate yet,
// or a vehicle that hasn't reported one) - distinct from being on time,
// which still returns a string so callers can show *something* once they
// know they have live data, rather than showing nothing either way.
export function formatDelay(delaySeconds: number | null): string | null {
  if (delaySeconds == null) return null;
  if (Math.abs(delaySeconds) < ON_TIME_TOLERANCE_S) return 'Ajallaan';
  const minutes = Math.round(Math.abs(delaySeconds) / 60);
  return delaySeconds > 0 ? `${minutes} min myöhässä` : `${minutes} min etuajassa`;
}
