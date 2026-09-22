import type { Theme } from '../composables/useTheme';

const DARK_BASEMAP_URL = 'https://tiles.openfreemap.org/styles/fiord';
const LIGHT_BASEMAP_URL = 'https://tiles.openfreemap.org/styles/liberty';

// "fiord" is OpenFreeMap's dark blue-slate style - picked over their plain
// "dark" style because "dark" renders water almost the same near-black as
// land, losing Helsinki's coastline entirely. fiord's own water color
// already reads clearly, and its blue-grey hue is what style.css's dark
// theme is tuned to sit alongside.
export function basemapStyleUrl(theme: Theme): string {
  return theme === 'dark' ? DARK_BASEMAP_URL : LIGHT_BASEMAP_URL;
}
