import type { LineLayerSpecification, StyleSpecification } from 'maplibre-gl';
import type { Theme } from '../composables/useTheme';

const DARK_BASEMAP_URL = 'https://tiles.openfreemap.org/styles/fiord';
const LIGHT_BASEMAP_URL = 'https://tiles.openfreemap.org/styles/liberty';

const RAIL_LAYER_IDS = new Set([
  'railway',
  'railway_dashline',
  'railway_service',
  'railway_service_dashline',
  'railway_transit',
  'railway_transit_dashline',
]);
// Liberty's equivalent rail hairline (`*_rail` / `*_rail_hatching`) has no
// minzoom floor and stays a thin, near-flat width until the map is zoomed
// well in. fiord's rail layers only appear from zoom 13 (mainline) or 16
// (trams/transit) - both invisible at the app's default city-wide zoom -
// and jump straight to a 3px-wide line at their minzoom, which reads as a
// sudden, oddly thick streak once you do zoom in rather than a hairline
// that scales in gradually.
const RAIL_WIDTH: LineLayerSpecification['paint'] = {
  'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 10, 0.3, 14, 0.6, 15, 1, 20, 3],
};

// "fiord" is OpenFreeMap's dark blue-slate style - picked over their plain
// "dark" style because "dark" renders water almost the same near-black as
// land, losing Helsinki's coastline entirely. fiord's own water color
// already reads clearly, and its blue-grey hue is what style.css's dark
// theme is tuned to sit alongside.
//
// Its rail layers needed their own fix (see RAIL_LAYER_IDS/RAIL_WIDTH
// above): dropped the minzoom floor, replaced the width curve, and unified
// the solid-line/dash-overlay pair onto one light tone - the stock style
// drew them as two different colors (a near-black solid line under a
// lighter dash), which read as misaligned rather than one deliberate track.
async function fetchFiordBasemap(): Promise<StyleSpecification> {
  const response = await fetch(DARK_BASEMAP_URL);
  const style = (await response.json()) as StyleSpecification;
  for (const layer of style.layers) {
    if (layer.type !== 'line' || !RAIL_LAYER_IDS.has(layer.id)) continue;
    layer.minzoom = 0;
    layer.paint = { ...layer.paint, ...RAIL_WIDTH, 'line-color': '#8f9ac0' };
  }
  return style;
}

export async function fetchBasemapStyle(theme: Theme): Promise<StyleSpecification | string> {
  return theme === 'dark' ? fetchFiordBasemap() : LIGHT_BASEMAP_URL;
}
