export const MODE_COLORS: Record<string, string> = {
  bus: '#3e8ef7',
  tram: '#29c783',
  metro: '#ff9f45',
  train: '#b07cff',
  ferry: '#35d6d6',
};

export const DEFAULT_MODE_COLOR = '#9a9a9a';

// Same orange HSL itself brands runkolinjat (trunk lines) with in its own
// app - only the line-number badge uses it, the vehicle dot on the map
// stays plain bus blue like every other bus (see PulseMap.vue).
export const TRUNK_BADGE_COLOR = '#ff9f45';

export function badgeColor(mode: string, isTrunk: boolean): string {
  return isTrunk ? TRUNK_BADGE_COLOR : modeColor(mode);
}

const MODE_LABELS: Record<string, string> = {
  bus: 'Bussi',
  tram: 'Raitiovaunu',
  metro: 'Metro',
  train: 'Juna',
  ferry: 'Lautta',
};

export function modeColor(mode: string): string {
  return MODE_COLORS[mode] ?? DEFAULT_MODE_COLOR;
}

export function modeLabel(mode: string): string {
  return MODE_LABELS[mode] ?? mode;
}

// Digitransit spells modes differently from HFP's topic segments (subway/rail
// vs metro/train); normalize so both feed the same MODE_COLORS/MODE_LABELS.
const DIGITRANSIT_MODE_ALIASES: Record<string, string> = {
  subway: 'metro',
  rail: 'train',
};

export function normalizeMode(mode: string): string {
  const lower = mode.toLowerCase();
  return DIGITRANSIT_MODE_ALIASES[lower] ?? lower;
}
