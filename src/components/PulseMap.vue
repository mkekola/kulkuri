<script setup lang="ts">
import { onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import {
  Map as MaplibreMap,
  NavigationControl,
  setWorkerUrl,
  type DataDrivenPropertyValueSpecification,
  type FilterSpecification,
  type GeoJSONSource,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// Vite bundles the app into one chunk, so it never sees maplibre-gl's own
// relative import of its worker (and the worker's own relative import of its
// shared chunk) - both would 404 in production otherwise. `scripts/copy-
// maplibre-assets.mjs` (run via `npm install`'s postinstall) copies both
// files, unhashed and side by side, into public/assets/ so this relative
// path is stable and the worker's internal import of the shared chunk still
// resolves next to it.
setWorkerUrl(`${import.meta.env.BASE_URL}assets/maplibre-gl-worker.mjs`);
import type { VehicleMap } from '../composables/useVehiclePositions';
import { DEFAULT_MODE_COLOR, MODE_COLORS, normalizeMode } from '../lib/vehicleModes';
import type { VehicleProperties } from '../lib/hfp';
import { FLUSH_INTERVAL_MS } from '../lib/hfp';
import {
  fetchStopDepartures,
  fetchStopsInBounds,
  type Departure,
  type RoutePath,
  type StopResult,
} from '../lib/digitransit';
import type { FavoriteStop } from '../composables/useFavorites';
import { loadStopIcons } from '../lib/stopIcons';
import VehicleDetail from './VehicleDetail.vue';
import StopDetail from './StopDetail.vue';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';

const props = defineProps<{
  vehicles: VehicleMap;
  activeMode: string;
  routePaths: RoutePath[];
  routeColor: string | null;
  favoriteStops: FavoriteStop[];
  locateRequest: { stop: FavoriteStop; nonce: number } | null;
  focusRouteRequest: { nonce: number } | null;
}>();
const emit = defineEmits<{ 'select-route': [route: string | null] }>();

const HELSINKI_CENTER: [number, number] = [24.9414, 60.1719];
// Roughly the HSL operating area (incl. commuter rail out to Riihimäki/
// Karjaa) plus a little breathing room. Keeps panning/zooming from ever
// reaching "empty" areas with no data - and from pulling in tiles for them.
const OPERATING_AREA_BOUNDS: [number, number, number, number] = [23.3, 59.7, 26.5, 61.05];
const MIN_ZOOM = 8.5;
const VEHICLES_SOURCE_ID = 'vehicles';
const VEHICLES_LAYER_ID = 'vehicles-layer';
const VEHICLES_HIT_LAYER_ID = 'vehicles-hit-layer';
const ROUTE_SOURCE_ID = 'route-path';
const ROUTE_GLOW_LAYER_ID = 'route-path-glow';
const ROUTE_LINE_LAYER_ID = 'route-path-line';
const ROUTE_DEFAULT_COLOR = '#ff7a45';
const STOPS_SOURCE_ID = 'stops';
const STOPS_LAYER_ID = 'stops-layer';
const FAVORITE_STOPS_SOURCE_ID = 'favorite-stops';
const FAVORITE_STOPS_LAYER_ID = 'favorite-stops-layer';
const FAVORITE_STOPS_LABEL_LAYER_ID = 'favorite-stops-label';
const FAVORITE_STOP_COLOR = '#ff7a45';
// Below this zoom, stopsByBbox would return far too many stops to be useful
// (and would clutter the "data as hero" motion view) - stops only appear
// once the viewer has zoomed in close enough to plausibly want one.
const MIN_STOPS_ZOOM = 15;
const STOPS_FETCH_DEBOUNCE_MS = 400;
const DEPARTURES_REFRESH_MS = 30_000;

const emptyCollection: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };
const emptyLineCollection: FeatureCollection<LineString> = {
  type: 'FeatureCollection',
  features: [],
};

const mapContainer = useTemplateRef<HTMLDivElement>('mapContainer');
const selectedVehicle = ref<VehicleProperties | null>(null);
const selectedStop = ref<StopResult | null>(null);
const stopDepartures = ref<Departure[] | null>(null);
let map: MaplibreMap | undefined;
let animationFrame: number | undefined;
// While true, the camera re-centers on the selected vehicle every frame as
// it moves. Turned off the moment the viewer drags/zooms by hand, so
// following never fights the user; turned back on for each new selection.
let followSelectedVehicle = false;
// map.isZooming() doesn't flip true soon enough to stop our per-frame
// setCenter() from fighting a two-finger pinch before MapLibre's touch
// handler registers it as a zoom - so this tracks raw touch count instead.
let multiTouchActive = false;
let stopsFetchTimer: ReturnType<typeof setTimeout> | undefined;
let departuresRefreshTimer: ReturnType<typeof setInterval> | undefined;

// Vehicles glide from their previous position to the latest HFP fix instead of
// jumping once a second: `previous` holds where each vehicle was heading before
// the last update, `target` mirrors the current `vehicles` prop.
const previous = new Map<string, [number, number]>();
let target: VehicleMap = new Map();
let lastFlushAt = performance.now();

// "Herääminen": vehicles wake up onto the map one at a time on first load
// instead of all popping in at once. `appearStart` holds when each vehicle's
// own fade/scale-in began; later arrivals (a bus starting its route) still
// get a quick individual fade-in, just without the staggered delay.
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const APPEAR_DURATION_MS = prefersReducedMotion ? 0 : 450;
// The whole first batch (which can be 1000+ vehicles across all of HSL)
// trickles in across this window rather than each getting a fixed per-vehicle
// delay, which would either crawl for a huge fleet or barely stagger a small one.
const WAKE_WINDOW_MS = 1400;
const appearStart = new Map<string, number>();
let hasReceivedFirstFlush = false;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function appearProgressAt(vehicleId: string, now: number): number {
  const start = appearStart.get(vehicleId) ?? now;
  const raw =
    APPEAR_DURATION_MS <= 0 ? 1 : Math.min(1, Math.max(0, (now - start) / APPEAR_DURATION_MS));
  return easeOutCubic(raw);
}

function visible(feature: Feature<Point, VehicleProperties>): boolean {
  return props.activeMode === 'all' || feature.properties.mode === props.activeMode;
}

function deselectVehicle() {
  selectedVehicle.value = null;
  emit('select-route', null);
}

function refreshDepartures() {
  const stop = selectedStop.value;
  if (!stop) return;
  const requested = stop.gtfsId;
  void fetchStopDepartures(requested).then((departures) => {
    if (selectedStop.value?.gtfsId === requested) stopDepartures.value = departures;
  });
}

function selectStop(stop: StopResult) {
  selectedStop.value = stop;
  stopDepartures.value = null;
  selectedVehicle.value = null;
  emit('select-route', null);
  refreshDepartures();
  clearInterval(departuresRefreshTimer);
  departuresRefreshTimer = setInterval(refreshDepartures, DEPARTURES_REFRESH_MS);
}

function deselectStop() {
  selectedStop.value = null;
  stopDepartures.value = null;
  clearInterval(departuresRefreshTimer);
}

function renderInterpolatedFrame(source: GeoJSONSource | undefined) {
  const now = performance.now();
  const t = Math.min(1, (now - lastFlushAt) / FLUSH_INTERVAL_MS);
  const features: Feature<Point, VehicleProperties & { appearProgress: number }>[] = [];

  for (const [vehicleId, feature] of target) {
    if (!visible(feature)) continue;
    const [lon, lat] = feature.geometry.coordinates;
    const [fromLon, fromLat] = previous.get(vehicleId) ?? [lon, lat];
    const interpolated: [number, number] = [
      fromLon + (lon - fromLon) * t,
      fromLat + (lat - fromLat) * t,
    ];
    features.push({
      ...feature,
      properties: { ...feature.properties, appearProgress: appearProgressAt(vehicleId, now) },
      geometry: { type: 'Point', coordinates: interpolated },
    });

    if (
      followSelectedVehicle &&
      selectedVehicle.value?.vehicleId === vehicleId &&
      map &&
      !map.isZooming() &&
      !multiTouchActive
    ) {
      // Skipped mid-zoom (wheel, or a two-finger pinch in progress): setting
      // the center every frame fights that gesture and stalls it entirely.
      // Once the zoom settles this picks the vehicle back up next frame.
      map.setCenter(interpolated);
    }
  }

  void source?.setData({ type: 'FeatureCollection', features });
  animationFrame = requestAnimationFrame(() => renderInterpolatedFrame(source));
}

onMounted(() => {
  if (!mapContainer.value) return;

  map = new MaplibreMap({
    container: mapContainer.value,
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: HELSINKI_CENTER,
    zoom: 12.5,
    minZoom: MIN_ZOOM,
    maxBounds: OPERATING_AREA_BOUNDS,
    attributionControl: { compact: true },
  });

  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');

  // Only an actual pan drag releases the follow - zooming (wheel, pinch,
  // +/- buttons) stays anchored on the vehicle so you can zoom in on it
  // while it keeps moving, which is the whole point of following it.
  map.on('dragstart', () => {
    followSelectedVehicle = false;
  });

  const canvasContainer = map.getCanvasContainer();
  canvasContainer.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      if (e.touches.length >= 2) multiTouchActive = true;
    },
    { passive: true },
  );
  const releaseMultiTouch = (e: TouchEvent) => {
    if (e.touches.length < 2) multiTouchActive = false;
  };
  canvasContainer.addEventListener('touchend', releaseMultiTouch, { passive: true });
  canvasContainer.addEventListener('touchcancel', releaseMultiTouch, { passive: true });

  map.on('load', () => {
    void initializeMapContent();
  });

  async function initializeMapContent() {
    if (!map) return;

    const icons = await loadStopIcons(MODE_COLORS, FAVORITE_STOP_COLOR);
    if (!map) return;
    for (const icon of icons) {
      if (!map.hasImage(icon.id))
        map.addImage(icon.id, icon.image, { pixelRatio: icon.pixelRatio });
    }

    // The base style draws its own generic transit-stop icons (OpenStreetMap
    // data, spread across poi_transit plus the general rank-tiered POI layers),
    // which land at slightly different spots than Digitransit's stop points and
    // don't distinguish mode. Hide just those - poi_r1/r7/r20 also carry shops,
    // landmarks etc. that should stay.
    const TRANSIT_POI_SUBCLASSES = [
      'bus_stop',
      'tram_stop',
      'station',
      'halt',
      'subway_entrance',
      'ferry_terminal',
      'platform',
    ];
    if (map.getLayer('poi_transit')) map.setLayoutProperty('poi_transit', 'visibility', 'none');
    for (const layerId of ['poi_r1', 'poi_r7', 'poi_r20']) {
      if (!map.getLayer(layerId)) continue;
      const existingFilter = map.getFilter(layerId);
      map.setFilter(layerId, [
        'all',
        ...(existingFilter ? [existingFilter] : []),
        ['!', ['match', ['get', 'subclass'], TRANSIT_POI_SUBCLASSES, true, false]],
      ] as unknown as FilterSpecification);
    }

    // The extruded 3D buildings the base style draws from zoom 14 up read as
    // visual noise here, not data - keep the flat building footprints, drop
    // the extrusion.
    if (map.getLayer('building-3d')) map.setLayoutProperty('building-3d', 'visibility', 'none');

    map.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: emptyLineCollection });
    map.addLayer({
      id: ROUTE_GLOW_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ROUTE_DEFAULT_COLOR,
        'line-width': 10,
        'line-blur': 6,
        'line-opacity': 0.35,
      },
    });
    map.addLayer({
      id: ROUTE_LINE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ROUTE_DEFAULT_COLOR,
        'line-width': 3,
        'line-opacity': 0.95,
      },
    });

    map.addSource(VEHICLES_SOURCE_ID, { type: 'geojson', data: emptyCollection });

    map.addLayer({
      id: VEHICLES_LAYER_ID,
      type: 'circle',
      source: VEHICLES_SOURCE_ID,
      paint: {
        'circle-radius': [
          '*',
          7,
          ['get', 'appearProgress'],
        ] as unknown as DataDrivenPropertyValueSpecification<number>,
        'circle-color': [
          'match',
          ['get', 'mode'],
          ...Object.entries(MODE_COLORS).flat(),
          DEFAULT_MODE_COLOR,
        ] as unknown as DataDrivenPropertyValueSpecification<string>,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-opacity': [
          '*',
          0.9,
          ['get', 'appearProgress'],
        ] as unknown as DataDrivenPropertyValueSpecification<number>,
        'circle-stroke-opacity': [
          'get',
          'appearProgress',
        ] as unknown as DataDrivenPropertyValueSpecification<number>,
      },
    });

    // Invisible, larger tap target around each vehicle dot - the visible
    // circle alone is too small to hit reliably, especially while it's
    // moving. Queried on click/hover instead of the visible layer.
    map.addLayer({
      id: VEHICLES_HIT_LAYER_ID,
      type: 'circle',
      source: VEHICLES_SOURCE_ID,
      paint: {
        'circle-radius': [
          '*',
          15,
          ['get', 'appearProgress'],
        ] as unknown as DataDrivenPropertyValueSpecification<number>,
        'circle-opacity': 0,
      },
    });

    map.addSource(STOPS_SOURCE_ID, { type: 'geojson', data: emptyCollection });
    map.addLayer({
      id: STOPS_LAYER_ID,
      type: 'symbol',
      source: STOPS_SOURCE_ID,
      layout: {
        'icon-image': ['concat', 'stop-icon-', ['get', 'mode']],
        'icon-size': 0.65,
        'icon-allow-overlap': true,
      },
    });

    map.addSource(FAVORITE_STOPS_SOURCE_ID, { type: 'geojson', data: emptyCollection });
    map.addLayer({
      id: FAVORITE_STOPS_LAYER_ID,
      type: 'symbol',
      source: FAVORITE_STOPS_SOURCE_ID,
      layout: {
        'icon-image': ['concat', 'favorite-icon-', ['get', 'mode']],
        'icon-size': 0.78,
        'icon-allow-overlap': true,
      },
    });
    map.addLayer({
      id: FAVORITE_STOPS_LABEL_LAYER_ID,
      type: 'symbol',
      source: FAVORITE_STOPS_SOURCE_ID,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.7],
        'text-anchor': 'top',
      },
      paint: {
        'text-color': '#e9edf4',
        'text-halo-color': '#0a0f1c',
        'text-halo-width': 1.2,
      },
    });

    const interactiveLayers = [VEHICLES_HIT_LAYER_ID, STOPS_LAYER_ID, FAVORITE_STOPS_LAYER_ID];
    for (const layerId of interactiveLayers) {
      map.on('mouseenter', layerId, () => {
        if (map) map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layerId, () => {
        if (map) map.getCanvas().style.cursor = '';
      });
    }

    map.on('click', (e) => {
      if (!map) return;

      const [vehicleHit] = map.queryRenderedFeatures(e.point, { layers: [VEHICLES_HIT_LAYER_ID] });
      if (vehicleHit) {
        const properties = vehicleHit.properties as VehicleProperties;
        selectedVehicle.value = properties;
        emit('select-route', properties.route ?? null);
        deselectStop();
        followSelectedVehicle = true;
        if (vehicleHit.geometry.type === 'Point') {
          map.easeTo({
            center: vehicleHit.geometry.coordinates as [number, number],
            duration: 500,
          });
        }
        return;
      }

      const [stopHit] = map.queryRenderedFeatures(e.point, {
        layers: [FAVORITE_STOPS_LAYER_ID, STOPS_LAYER_ID],
      });
      if (stopHit && stopHit.geometry.type === 'Point') {
        const p = stopHit.properties as { gtfsId: string; name: string; code: string | null };
        const [lon, lat] = stopHit.geometry.coordinates;
        selectStop({ gtfsId: p.gtfsId, name: p.name, code: p.code, lat, lon });
        return;
      }

      selectedVehicle.value = null;
      emit('select-route', null);
      deselectStop();
    });

    // eslint's type resolution doesn't pick up GeoJSONSource here, unlike vue-tsc.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const source = map.getSource(VEHICLES_SOURCE_ID) as GeoJSONSource | undefined;
    animationFrame = requestAnimationFrame(() => renderInterpolatedFrame(source));

    watch(
      () => props.vehicles,
      (nextVehicles) => {
        for (const [vehicleId, feature] of target) {
          const [lon, lat] = feature.geometry.coordinates;
          previous.set(vehicleId, [lon, lat]);
        }
        target = nextVehicles;
        for (const vehicleId of previous.keys()) {
          if (!target.has(vehicleId)) previous.delete(vehicleId);
        }
        lastFlushAt = performance.now();

        if (target.size > 0) {
          // On the very first flush appearStart is empty, so every vehicle here is
          // new; spread that whole opening batch across the wake-up window. Any
          // vehicle appearing later (a bus starting its shift) just gets delay 0.
          const isFirstFlush = !hasReceivedFirstFlush;
          let staggerIndex = 0;
          for (const vehicleId of target.keys()) {
            if (appearStart.has(vehicleId)) continue;
            const delay = isFirstFlush
              ? (staggerIndex / Math.max(1, target.size - 1)) * WAKE_WINDOW_MS
              : 0;
            appearStart.set(vehicleId, lastFlushAt + delay);
            staggerIndex += 1;
          }
          hasReceivedFirstFlush = true;
        }
        for (const vehicleId of appearStart.keys()) {
          if (!target.has(vehicleId)) appearStart.delete(vehicleId);
        }

        if (selectedVehicle.value) {
          selectedVehicle.value = target.get(selectedVehicle.value.vehicleId)?.properties ?? null;
        }
      },
      { immediate: true },
    );

    watch(
      () => [props.routePaths, props.routeColor] as const,
      ([paths, color]) => {
        if (!map) return;
        // eslint's type resolution doesn't pick up GeoJSONSource here, unlike vue-tsc.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        const routeSource = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
        void routeSource?.setData({
          type: 'FeatureCollection',
          features: paths.map((path) => ({
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: path },
          })),
        });
        const lineColor = color ?? ROUTE_DEFAULT_COLOR;
        map.setPaintProperty(ROUTE_GLOW_LAYER_ID, 'line-color', lineColor);
        map.setPaintProperty(ROUTE_LINE_LAYER_ID, 'line-color', lineColor);
      },
      { immediate: true },
    );

    watch(
      () => props.favoriteStops,
      (stops) => {
        if (!map) return;
        // eslint's type resolution doesn't pick up GeoJSONSource here, unlike vue-tsc.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        const stopsSource = map.getSource(FAVORITE_STOPS_SOURCE_ID) as GeoJSONSource | undefined;
        void stopsSource?.setData({
          type: 'FeatureCollection',
          features: stops.map((stop) => ({
            type: 'Feature',
            properties: { gtfsId: stop.gtfsId, name: stop.name, code: stop.code, mode: stop.mode },
            geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
          })),
        });
      },
      { immediate: true },
    );

    watch(
      () => props.locateRequest,
      (request) => {
        if (!map || !request) return;
        map.flyTo({ center: [request.stop.lon, request.stop.lat], zoom: 16, duration: 1200 });
      },
    );

    watch(
      () => props.focusRouteRequest,
      (request) => {
        if (!map || !request) return;
        const coords = props.routePaths.flat();
        if (coords.length === 0) return;
        let minLon = coords[0][0];
        let maxLon = coords[0][0];
        let minLat = coords[0][1];
        let maxLat = coords[0][1];
        for (const [lon, lat] of coords) {
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
        map.fitBounds(
          [
            [minLon, minLat],
            [maxLon, maxLat],
          ],
          { padding: 64, maxZoom: 15, duration: 900 },
        );
      },
    );

    function scheduleStopsFetch() {
      clearTimeout(stopsFetchTimer);
      stopsFetchTimer = setTimeout(() => {
        if (!map) return;
        // eslint's type resolution doesn't pick up GeoJSONSource here, unlike vue-tsc.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        const stopsSource = map.getSource(STOPS_SOURCE_ID) as GeoJSONSource | undefined;
        if (map.getZoom() < MIN_STOPS_ZOOM) {
          void stopsSource?.setData(emptyCollection);
          return;
        }
        const bounds = map.getBounds();
        void fetchStopsInBounds({
          minLat: bounds.getSouth(),
          minLon: bounds.getWest(),
          maxLat: bounds.getNorth(),
          maxLon: bounds.getEast(),
        }).then((stops) => {
          void stopsSource?.setData({
            type: 'FeatureCollection',
            features: stops.map((stop) => ({
              type: 'Feature',
              properties: {
                gtfsId: stop.gtfsId,
                name: stop.name,
                code: stop.code,
                mode: normalizeMode(stop.vehicleMode ?? ''),
              },
              geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
            })),
          });
        });
      }, STOPS_FETCH_DEBOUNCE_MS);
    }
    map.on('moveend', scheduleStopsFetch);
  }
});

onUnmounted(() => {
  if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
  clearTimeout(stopsFetchTimer);
  clearInterval(departuresRefreshTimer);
  map?.remove();
});
</script>

<template>
  <div ref="mapContainer" class="pulse-map" />
  <VehicleDetail v-if="selectedVehicle" :vehicle="selectedVehicle" @close="deselectVehicle" />
  <StopDetail
    v-else-if="selectedStop"
    :stop="selectedStop"
    :departures="stopDepartures"
    @close="deselectStop"
  />
</template>

<style scoped>
.pulse-map {
  position: absolute;
  inset: 0;
  border-radius: 16px;
  overflow: hidden;
}
</style>
