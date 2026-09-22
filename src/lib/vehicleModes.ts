export const MODE_COLORS: Record<string, string> = {
  bus: '#3e8ef7',
  tram: '#29c783',
  metro: '#ff9f45',
  train: '#b07cff',
  ferry: '#35d6d6',
};

export const DEFAULT_MODE_COLOR = '#9a9a9a';

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
