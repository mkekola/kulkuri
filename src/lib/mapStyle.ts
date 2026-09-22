import type { FillLayerSpecification, LineLayerSpecification, StyleSpecification } from 'maplibre-gl';
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

// District/place-name labels (Töölö, Kallio, ...) came in a cyan-blue that
// read as an unintentional stray color next to the rest of the palette.
// Matches the favorite-stop labels we draw ourselves (FAVORITE_STOPS_LABEL_LAYER_ID
// in PulseMap.vue) - same white-on-navy so map-drawn and app-drawn text
// look like one system.
const PLACE_LAYER_IDS = new Set([
  'place_other',
  'place_suburb',
  'place_village',
  'place_town',
  'place_city',
  'place_city_large',
]);
const PLACE_LABEL_COLOR = { 'text-color': '#e9edf4', 'text-halo-color': '#0a0f1c' };

// Parks and wooded areas came in the same blue-slate hue as everything
// else, so green space didn't read as green space. Shifted to a muted
// green at roughly the same lightness/saturation as the originals, rather
// than a brighter green that would fight the rest of the muted palette.
const LANDCOVER_COLOR: Record<string, Record<string, unknown>> = {
  park: { 'fill-color': 'hsl(145,22%,30%)' },
  park_outline: { 'line-color': 'hsl(145,40%,32%)' },
  landcover_wood: { 'fill-color': 'hsla(145,18%,26%,0.57)' },
};

// Unlike "liberty", fiord's own style has no `landcover_grass` layer at
// all - the underlying vector tiles carry a "grass" landcover class (large
// areas like Töölönlahti read as grass rather than "park" or "wood"), but
// fiord's style just never draws it, so those areas showed the plain
// background color instead of green. Ported liberty's layer definition
// (same shared `openmaptiles` source/source-layer) with our green instead
// of its brighter one.
const GRASS_LAYER: FillLayerSpecification = {
  id: 'landcover_grass',
  type: 'fill',
  source: 'openmaptiles',
  'source-layer': 'landcover',
  filter: ['==', ['get', 'class'], 'grass'],
  paint: { 'fill-color': 'hsl(145,20%,28%)', 'fill-opacity': 0.35 },
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
    if (layer.type === 'line' && RAIL_LAYER_IDS.has(layer.id)) {
      layer.minzoom = 0;
      layer.paint = { ...layer.paint, ...RAIL_WIDTH, 'line-color': '#6c76a0' };
    } else if (layer.type === 'symbol' && PLACE_LAYER_IDS.has(layer.id)) {
      layer.paint = { ...layer.paint, ...PLACE_LABEL_COLOR };
    } else if (layer.id in LANDCOVER_COLOR) {
      layer.paint = { ...layer.paint, ...LANDCOVER_COLOR[layer.id] };
    }
  }
  const woodIndex = style.layers.findIndex((layer) => layer.id === 'landcover_wood');
  style.layers.splice(woodIndex + 1, 0, GRASS_LAYER);
  return style;
}

export async function fetchBasemapStyle(theme: Theme): Promise<StyleSpecification | string> {
  return theme === 'dark' ? fetchFiordBasemap() : LIGHT_BASEMAP_URL;
}
