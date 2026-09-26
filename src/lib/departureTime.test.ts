import { describe, expect, it } from 'vitest';
import { formatDelay, formatDepartureCountdown } from './departureTime';

describe('formatDepartureCountdown', () => {
  const now = Date.UTC(2024, 0, 15, 10, 0, 0);

  it('reads "nyt" for a departure right now', () => {
    expect(formatDepartureCountdown(now, now)).toBe('nyt');
  });

  it('reads "nyt" for a departure already in the past', () => {
    expect(formatDepartureCountdown(now - 5 * 60_000, now)).toBe('nyt');
  });

  it('counts minutes under an hour away', () => {
    expect(formatDepartureCountdown(now + 5 * 60_000, now)).toBe('5 min');
    expect(formatDepartureCountdown(now + 59 * 60_000, now)).toBe('59 min');
  });

  it('rounds to the nearest minute', () => {
    expect(formatDepartureCountdown(now + 90_000, now)).toBe('2 min');
  });

  it('switches to a clock time an hour or more out', () => {
    const departureAt = now + 65 * 60_000; // 11:05 UTC = 13:05 Europe/Helsinki (winter, UTC+2)
    expect(formatDepartureCountdown(departureAt, now)).toBe('13:05');
  });
});

describe('formatDelay', () => {
  it('returns null when there is no live delay data', () => {
    expect(formatDelay(null)).toBeNull();
  });

  it('treats anything under a minute either way as on time', () => {
    expect(formatDelay(0)).toBe('Ajallaan');
    expect(formatDelay(30)).toBe('Ajallaan');
    expect(formatDelay(-59)).toBe('Ajallaan');
  });

  it('reports being late past the tolerance', () => {
    expect(formatDelay(60)).toBe('1 min myöhässä');
    expect(formatDelay(125)).toBe('2 min myöhässä');
  });

  it('reports being early past the tolerance', () => {
    expect(formatDelay(-60)).toBe('1 min etuajassa');
    expect(formatDelay(-125)).toBe('2 min etuajassa');
  });
});
