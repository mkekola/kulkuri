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
import { useTheme, type Theme } from '../composables/useTheme';
import { loadStopIcons, UNKNOWN_STOP_MODE } from '../lib/stopIcons';
import { fetchBasemapStyle } from '../lib/mapStyle';
import { anchoredPositionAt, type AnchoredPosition } from '../lib/anchoredPopup';
import VehicleDetail from './VehicleDetail.vue';
import StopDetail from './StopDetail.vue';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';

const props = defineProps<{
  vehicles: VehicleMap;
  activeMode: string;
  selectedRoute: string | null;
  routePaths: RoutePath[];
  routeColor: string | null;
  favoriteStops: FavoriteStop[];
  locateRequest: { stop: FavoriteStop; nonce: number } | null;
  focusRouteRequest: { nonce: number } | null;
}>();
const emit = defineEmits<{ 'select-route': [route: string | null] }>();

// Only the theme active when the map first mounts picks its basemap style -
// toggling afterwards re-skins the DOM chrome instantly, but re-styling a
// live map means re-adding every custom source/layer/handler below, which
// isn't wired up yet. A reload after toggling picks up the matching map.
const { theme } = useTheme();

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
// Matches --accent in style.css. Drawn straight onto the map canvas (a
// MapLibre paint property, not DOM), so it can't read the CSS custom
// property and is kept here as a literal - it stays constant across the
// dark/light theme toggle, same as --accent itself.
const ROUTE_DEFAULT_COLOR = '#ff7a45';
const STOPS_SOURCE_ID = 'stops';
const STOPS_LAYER_ID = 'stops-layer';
const FAVORITE_STOPS_SOURCE_ID = 'favorite-stops';
const FAVORITE_STOPS_LAYER_ID = 'favorite-stops-layer';
const FAVORITE_STOPS_LABEL_LAYER_ID = 'favorite-stops-label';
const FAVORITE_STOP_COLOR = '#ff7a45';
// Matches --text/--bg per theme (style.css) - same pair mapStyle.ts uses for
// fiord's own place labels in dark mode, but here applied to both themes
// since this layer (unlike fiord's) is drawn by us regardless of basemap.
const FAVORITE_STOP_LABEL_COLORS: Record<Theme, { text: string; halo: string }> = {
  dark: { text: '#e9edf4', halo: '#0a0f1c' },
  light: { text: '#121a2c', halo: '#f3f5fa' },
};
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
// Screen-space position of whichever card is showing, kept in sync every
// animation frame (vehicles move; a stop's own screen position shifts as
// the map pans/zooms) - see renderInterpolatedFrame(). Also set immediately
// on click so the card doesn't wait a frame to appear in the right spot.
const selectedVehiclePosition = ref<AnchoredPosition | null>(null);
const selectedStopPosition = ref<AnchoredPosition | null>(null);
let map: MaplibreMap | undefined;
let animationFrame: number | undefined;
// watch() calls below are all created inside onMounted's async flow (after
// map 'load'/theme changes), outside Vue's synchronous setup() tracking -
// so they aren't auto-stopped on unmount like a plain setup()-scope watch
// would be. Collected here and stopped by hand in onUnmounted instead.
const watcherStops: (() => void)[] = [];
// While true, the camera re-centers on the selected vehicle every frame as
// it moves (see setFollowingVehicle() below, which also keeps zoom gestures
// anchored on that same center). Turned off the moment the viewer drags the
// map by hand, so following never fights a deliberate pan; zooming in/out
// doesn't turn it off - that's the whole point of following.
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

// Wraps anchoredPositionAt() with this component's own map/container -
// callers just give it a lng/lat.
function anchoredScreenPosition(lngLat: [number, number]): AnchoredPosition | null {
  if (!map || !mapContainer.value) return null;
  return anchoredPositionAt(
    map.project(lngLat),
    mapContainer.value.clientWidth,
    mapContainer.value.clientHeight,
  );
}

// Wheel/pinch zoom normally keeps whatever point is under the cursor or
// touch fixed, not the map center - fine for free browsing, but while
// following a vehicle that fights the per-frame setCenter() below: the
// zoom drifts the vehicle away from center, and the very next frame after
// it settles snaps the camera straight back, reading as an ugly jump. This
// re-anchors both gestures on the map's own center for the duration of the
// follow, so the (centered) vehicle just stays put through the whole zoom
// instead of jumping once it's over.
function setFollowingVehicle(following: boolean) {
  followSelectedVehicle = following;
  if (!map) return;
  // enable() is a no-op while the handler is already enabled (the default),
  // so it never actually applies a new `around` option on its own - it has
  // to be disabled first for that option to take effect at all.
  map.scrollZoom.disable();
  map.scrollZoom.enable(following ? { around: 'center' } : undefined);
  map.touchZoomRotate.disable();
  map.touchZoomRotate.enable(following ? { around: 'center' } : undefined);
}

function deselectVehicle() {
  selectedVehicle.value = null;
  setFollowingVehicle(false);
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
  selectedStopPosition.value = anchoredScreenPosition([stop.lon, stop.lat]);
  stopDepartures.value = null;
  deselectVehicle();
  refreshDepartures();
  clearInterval(departuresRefreshTimer);
  departuresRefreshTimer = setInterval(refreshDepartures, DEPARTURES_REFRESH_MS);
}

function deselectStop() {
  selectedStop.value = null;
  stopDepartures.value = null;
  clearInterval(departuresRefreshTimer);
}

function renderInterpolatedFrame() {
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

    if (selectedVehicle.value?.vehicleId === vehicleId) {
      if (followSelectedVehicle && map && !map.isZooming() && !multiTouchActive) {
        // Skipped mid-zoom (wheel, or a two-finger pinch in progress):
        // setting the center every frame fights that gesture and stalls it
        // entirely. Once the zoom settles this picks the vehicle back up
        // next frame.
        map.setCenter(interpolated);
      }
      selectedVehiclePosition.value = anchoredScreenPosition(interpolated);
    }
  }

  if (selectedStop.value) {
    selectedStopPosition.value = anchoredScreenPosition([
      selectedStop.value.lon,
      selectedStop.value.lat,
    ]);
  }

  // Looked up fresh every frame rather than captured once - a theme switch's
  // setStyle() tears down and re-adds this source under addMapLayers(), and
  // a closed-over reference to the old (now-detached) source object would
  // silently stop updating the map after every theme toggle.
  // eslint's type resolution doesn't pick up GeoJSONSource here, unlike vue-tsc.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const source = map?.getSource(VEHICLES_SOURCE_ID) as GeoJSONSource | undefined;
  void source?.setData({ type: 'FeatureCollection', features });
  animationFrame = requestAnimationFrame(() => renderInterpolatedFrame());
}

onMounted(async () => {
  if (!mapContainer.value) return;

  const style = await fetchBasemapStyle(theme.value);
  if (!mapContainer.value) return; // Component could unmount while the style was loading.

  map = new MaplibreMap({
    container: mapContainer.value,
    style,
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
    setFollowingVehicle(false);
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

  let initialLoadComplete = false;
  map.on('load', () => {
    initialLoadComplete = true;
    void addMapLayers().then(() => setupInteractionsAndWatchers());
  });

  // A theme toggle fired before the map's very first 'load' would otherwise
  // race that initial addMapLayers() call - both try to add the same
  // sources/layers, and the second one throws ("Source already exists").
  // Waiting here just means a toggle during that narrow window applies once
  // the initial load catches up, instead of crashing the map.
  function waitForInitialLoad(): Promise<void> {
    if (initialLoadComplete) return Promise.resolve();
    return new Promise((resolve) => {
      map?.once('load', () => resolve());
    });
  }

  // Toggling the theme re-skins the DOM instantly, but the map itself needs
  // a whole new basemap style - which wipes every custom source/layer/image
  // that isn't part of it. setStyle() swaps the basemap; `style.load` fires
  // once it (and its sprite/glyphs) are ready, and that's when addMapLayers
  // re-adds ours. The click/hover handlers and prop watchers set up by
  // setupInteractionsAndWatchers() aren't re-registered here - they're
  // pure event delegation keyed by layer ID, not references to the removed
  // layer objects, so they keep working against the layers addMapLayers()
  // re-creates.
  watcherStops.push(
    watch(theme, async (newTheme) => {
      if (!map) return;
      await waitForInitialLoad();
      if (!map) return;
      const style = await fetchBasemapStyle(newTheme);
      if (!map) return;
      // Registered before setStyle() rather than after: a URL-sourced style
      // (light) needs a network fetch, so 'style.load' always lands safely
      // later - but the dark style is already a parsed object by this point
      // (fetchBasemapStyle() did that fetch itself, above), and MapLibre can
      // fire 'style.load' for it fast enough that a listener attached after
      // setStyle() sometimes missed it entirely, silently skipping
      // addMapLayers() and leaving the map with no vehicles or stops.
      map.once('style.load', () => {
        void addMapLayers();
        // Reuse "Herääminen" for a theme switch too: every tracked vehicle
        // re-appears from appearProgress 0 instead of popping back in
        // instantly once the vehicle layer above is re-added. The next HFP
        // flush (the props.vehicles watcher below, within FLUSH_INTERVAL_MS)
        // treats them all as newly arrived and restaggers the fade-in across
        // WAKE_WINDOW_MS, same as the very first load.
        appearStart.clear();
        hasReceivedFirstFlush = false;
      });
      map.setStyle(style);
    }),
  );

  async function addMapLayers() {
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
        'text-color': FAVORITE_STOP_LABEL_COLORS[theme.value].text,
        'text-halo-color': FAVORITE_STOP_LABEL_COLORS[theme.value].halo,
        'text-halo-width': 1.2,
      },
    });
  }

  // Everything below is pure event delegation and prop watching, not tied to
  // any specific layer/source object - it's set up once, ever, and keeps
  // working across addMapLayers() re-adding layers after a style change.
  function setupInteractionsAndWatchers() {
    if (!map) return;

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
        setFollowingVehicle(true);
        if (vehicleHit.geometry.type === 'Point') {
          const coords = vehicleHit.geometry.coordinates as [number, number];
          selectedVehiclePosition.value = anchoredScreenPosition(coords);
          map.easeTo({ center: coords, duration: 500 });
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

      deselectVehicle();
      deselectStop();
    });

    animationFrame = requestAnimationFrame(() => renderInterpolatedFrame());

    watcherStops.push(
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
            const stillPresent = target.get(selectedVehicle.value.vehicleId)?.properties;
            selectedVehicle.value = stillPresent ?? null;
            if (!stillPresent) setFollowingVehicle(false);
          }
        },
        { immediate: true },
      ),
    );

    watcherStops.push(
      watch(
        () => props.selectedRoute,
        (route) => {
          // A route change that didn't come from clicking this very vehicle
          // (picking a different line from the sidebar, or deselecting one)
          // should drop its detail card instead of leaving it stranded on
          // screen. Clicking a vehicle sets selectedVehicle and emits its
          // own route synchronously, so by the time this watcher sees that
          // route it already matches and nothing is cleared.
          if (selectedVehicle.value && selectedVehicle.value.route !== route) {
            selectedVehicle.value = null;
            setFollowingVehicle(false);
          }
        },
      ),
    );

    watcherStops.push(
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
      ),
    );

    watcherStops.push(
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
              properties: {
                gtfsId: stop.gtfsId,
                name: stop.name,
                code: stop.code,
                mode: stop.mode,
              },
              geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
            })),
          });
        },
        { immediate: true },
      ),
    );

    watcherStops.push(
      watch(
        () => props.locateRequest,
        (request) => {
          if (!map || !request) return;
          map.flyTo({ center: [request.stop.lon, request.stop.lat], zoom: 16, duration: 1200 });
        },
      ),
    );

    watcherStops.push(
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
      ),
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
                mode: stop.vehicleMode ? normalizeMode(stop.vehicleMode) : UNKNOWN_STOP_MODE,
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
  for (const stop of watcherStops) stop();
  map?.remove();
});
</script>

<template>
  <div class="pulse-map-wrapper">
    <div ref="mapContainer" class="pulse-map" />
    <VehicleDetail
      v-if="selectedVehicle && selectedVehiclePosition"
      :vehicle="selectedVehicle"
      :position="selectedVehiclePosition"
      @close="deselectVehicle"
    />
    <StopDetail
      v-else-if="selectedStop && selectedStopPosition"
      :stop="selectedStop"
      :departures="stopDepartures"
      :position="selectedStopPosition"
      @close="deselectStop"
    />
  </div>
</template>

<style scoped>
.pulse-map-wrapper {
  position: absolute;
  inset: 0;
}

.pulse-map {
  position: absolute;
  inset: 0;
  border-radius: 16px;
  overflow: hidden;
}
</style>
