import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODE_COLOR,
  MODE_COLORS,
  TRUNK_BADGE_COLOR,
  badgeColor,
  modeColor,
  modeLabel,
  normalizeMode,
} from './vehicleModes';

describe('modeColor', () => {
  it('returns the known color for each mode', () => {
    for (const [mode, color] of Object.entries(MODE_COLORS)) {
      expect(modeColor(mode)).toBe(color);
    }
  });

  it('falls back to the default color for an unknown mode', () => {
    expect(modeColor('taxi')).toBe(DEFAULT_MODE_COLOR);
  });
});

describe('modeLabel', () => {
  it('returns the Finnish label for each known mode', () => {
    expect(modeLabel('bus')).toBe('Bussi');
    expect(modeLabel('ferry')).toBe('Lautta');
  });

  it('falls back to the raw mode string for an unknown mode', () => {
    expect(modeLabel('taxi')).toBe('taxi');
  });
});

describe('badgeColor', () => {
  it('uses the trunk color regardless of mode when isTrunk is true', () => {
    expect(badgeColor('bus', true)).toBe(TRUNK_BADGE_COLOR);
    expect(badgeColor('tram', true)).toBe(TRUNK_BADGE_COLOR);
  });

  it('falls back to the mode color when isTrunk is false', () => {
    expect(badgeColor('bus', false)).toBe(MODE_COLORS.bus);
  });
});

describe('normalizeMode', () => {
  it('maps Digitransit spellings onto HFP ones', () => {
    expect(normalizeMode('subway')).toBe('metro');
    expect(normalizeMode('rail')).toBe('train');
  });

  it('lowercases and passes through anything else unchanged', () => {
    expect(normalizeMode('BUS')).toBe('bus');
    expect(normalizeMode('Subway')).toBe('metro');
    expect(normalizeMode('ferry')).toBe('ferry');
  });
});
