import type { StyleSpecification } from 'maplibre-gl';
import type { Theme } from '../composables/useTheme';

const DARK_BASEMAP_URL = 'https://tiles.openfreemap.org/styles/dark';
const LIGHT_BASEMAP_URL = 'https://tiles.openfreemap.org/styles/liberty';

// OpenFreeMap's "dark" style renders water almost the same near-black as
// land (rgb(27,27,29) on rgb(12,12,12)), so the sea all but disappears -
// a problem for a transit map, and a shame for an app named after lake
// water. This re-tints just the water layers to a dark teal matching
// --accent in style.css, so the coastline reads clearly without pulling
// in a whole competing hue the way the "fiord" style's blue-grey would.
async function fetchJarvivesiDarkBasemap(): Promise<StyleSpecification> {
  const response = await fetch(DARK_BASEMAP_URL);
  const style = (await response.json()) as StyleSpecification;
  for (const layer of style.layers) {
    if (layer.id === 'water' && layer.type === 'fill') {
      layer.paint = { ...layer.paint, 'fill-color': '#0e3235' };
    } else if (layer.id === 'waterway' && layer.type === 'line') {
      layer.paint = { ...layer.paint, 'line-color': '#175056' };
    } else if (layer.id === 'water_name' && layer.type === 'symbol') {
      layer.paint = { ...layer.paint, 'text-color': '#5fa39d', 'text-halo-color': '#0c1414' };
    }
  }
  return style;
}

// The light theme keeps OpenFreeMap's stock "liberty" style - it's already
// light and doesn't need a water re-tint the way the near-black "dark"
// style did.
export async function fetchBasemapStyle(theme: Theme): Promise<StyleSpecification | string> {
  return theme === 'dark' ? fetchJarvivesiDarkBasemap() : LIGHT_BASEMAP_URL;
}
