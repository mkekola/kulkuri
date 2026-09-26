<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import {
  GeolocateControl,
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
  type ServiceAlert,
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
const emit = defineEmits<{
  'select-route': [route: string | null];
  'add-favorite-stop': [stop: FavoriteStop];
  'remove-favorite-stop': [gtfsId: string];
}>();

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
const MIN_STOPS_ZOOM = 14;
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
// Mode isn't part of StopResult itself (only needed here, for favoriting) -
// captured separately from whichever click selected the stop, already
// normalized (the map layers' own feature properties carry it that way).
const selectedStopMode = ref<string | null>(null);
const stopDepartures = ref<Departure[] | null>(null);
const stopAlerts = ref<ServiceAlert[]>([]);
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
// MapLibre's setCenter() is a synchronous jump - it fires 'moveend' on every
// single call, not just user-driven ones. Without this flag, the per-frame
// setCenter() below while following a vehicle would fire 'moveend' up to 60
// times a second, and the nearby-stop fetch's own debounce (scheduleStopsFetch,
// see setupInteractionsAndWatchers()) would keep getting reset by it forever -
// freezing the stop markers for as long as the follow lasts instead of ever
// actually refreshing them.
let programmaticCenterUpdate = false;
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

// Rough, deliberately unscaled-for-real-distance ranking (just picking the
// nearest of possibly several live vehicles on the same route) - cos(lat)
// keeps a degree of longitude from being overweighted against a degree of
// latitude at this latitude, nothing more precise is needed just to pick a
// winner.
function approxDistanceSq(a: [number, number], b: [number, number]): number {
  const latScale = Math.cos((a[1] * Math.PI) / 180);
  const dLon = (a[0] - b[0]) * latScale;
  const dLat = a[1] - b[1];
  return dLon * dLon + dLat * dLat;
}

// A departure in the stop popup is a scheduled trip, not necessarily a
// vehicle currently out on the road - HFP (target) only has entries for
// ones that are. Several vehicles can share a route number at once (e.g.
// both directions, or a busy trunk line), so the one nearest this stop is
// picked as the one most likely to actually be *this* departure. Silently
// does nothing if none are currently running it.
function locateVehicleOnRoute(routeId: string) {
  if (!map) return;
  const stop = selectedStop.value;
  let nearest: VehicleProperties | null = null;
  let nearestCoords: [number, number] | null = null;
  let nearestDistSq = Infinity;
  for (const feature of target.values()) {
    if (feature.properties.route !== routeId) continue;
    const coords = feature.geometry.coordinates as [number, number];
    const distSq = stop ? approxDistanceSq([stop.lon, stop.lat], coords) : 0;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearest = feature.properties;
      nearestCoords = coords;
    }
  }
  if (!nearest || !nearestCoords) return;

  selectedVehicle.value = nearest;
  selectedVehiclePosition.value = anchoredScreenPosition(nearestCoords);
  emit('select-route', nearest.route ?? null);
  deselectStop();
  setFollowingVehicle(true);
  map.easeTo({ center: nearestCoords, duration: 500 });
}

function refreshDepartures() {
  const stop = selectedStop.value;
  if (!stop) return;
  const requested = stop.gtfsId;
  void fetchStopDepartures(requested).then(({ departures, alerts }) => {
    if (selectedStop.value?.gtfsId !== requested) return;
    stopDepartures.value = departures;
    stopAlerts.value = alerts;
  });
}

function selectStop(stop: StopResult, mode: string | null) {
  selectedStop.value = stop;
  selectedStopMode.value = mode;
  selectedStopPosition.value = anchoredScreenPosition([stop.lon, stop.lat]);
  stopDepartures.value = null;
  stopAlerts.value = [];
  deselectVehicle();
  refreshDepartures();
  clearInterval(departuresRefreshTimer);
  departuresRefreshTimer = setInterval(refreshDepartures, DEPARTURES_REFRESH_MS);
}

const isSelectedStopFavorite = computed(
  () =>
    selectedStop.value != null &&
    props.favoriteStops.some((favorite) => favorite.gtfsId === selectedStop.value?.gtfsId),
);

function toggleSelectedStopFavorite() {
  const stop = selectedStop.value;
  if (!stop) return;
  if (isSelectedStopFavorite.value) {
    emit('remove-favorite-stop', stop.gtfsId);
    return;
  }
  emit('add-favorite-stop', {
    gtfsId: stop.gtfsId,
    name: stop.name,
    code: stop.code,
    lat: stop.lat,
    lon: stop.lon,
    mode: selectedStopMode.value ?? UNKNOWN_STOP_MODE,
  });
}

function deselectStop() {
  selectedStop.value = null;
  selectedStopMode.value = null;
  stopDepartures.value = null;
  stopAlerts.value = [];
  clearInterval(departuresRefreshTimer);
}

// Rebuilding the full feature collection and pushing it through setData()
// is the expensive part of this loop (GeoJSON re-parse/re-index for
// potentially 1000+ vehicles across all of HSL) - doing that at a full
// 60fps saturates the main thread on a real phone badly enough to make an
// active pinch gesture (which needs a steady stream of touchmove events to
// track smoothly) feel like it's "fighting back", even though double-tap
// zoom - a single recognized gesture followed by its own independent
// animation, not continuous per-frame tracking - felt fine. 30fps is still
// smooth for slow bus/tram motion interpolated across a 1s window and
// roughly halves that cost.
const RENDER_INTERVAL_MS = 1000 / 30;
let lastRenderedAt = 0;

function renderInterpolatedFrame() {
  const now = performance.now();
  const t = Math.min(1, (now - lastFlushAt) / FLUSH_INTERVAL_MS);
  // The selected vehicle's own camera-follow/popup tracking stays at full
  // frame rate below (cheap - one vehicle's arithmetic) regardless of
  // whether this frame also rebuilds the full fleet's dots.
  const rebuildFleet = now - lastRenderedAt >= RENDER_INTERVAL_MS;
  const features: Feature<Point, VehicleProperties & { appearProgress: number }>[] | undefined =
    rebuildFleet ? [] : undefined;

  for (const [vehicleId, feature] of target) {
    if (!visible(feature)) continue;
    const [lon, lat] = feature.geometry.coordinates;
    const [fromLon, fromLat] = previous.get(vehicleId) ?? [lon, lat];
    const interpolated: [number, number] = [
      fromLon + (lon - fromLon) * t,
      fromLat + (lat - fromLat) * t,
    ];
    features?.push({
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
        programmaticCenterUpdate = true;
        map.setCenter(interpolated);
        programmaticCenterUpdate = false;
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

  if (features) {
    lastRenderedAt = now;
    // Looked up fresh every frame rather than captured once - a theme
    // switch's setStyle() tears down and re-adds this source under
    // addMapLayers(), and a closed-over reference to the old (now-detached)
    // source object would silently stop updating the map after every theme
    // toggle.
    // eslint's type resolution doesn't pick up GeoJSONSource here, unlike vue-tsc.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const source = map?.getSource(VEHICLES_SOURCE_ID) as GeoJSONSource | undefined;
    void source?.setData({ type: 'FeatureCollection', features });
  }
  animationFrame = requestAnimationFrame(() => renderInterpolatedFrame());
}

// See the onMounted listener registration below for why this exists at all.
function preventSafariGesture(e: Event) {
  e.preventDefault();
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
    // This app has never had a rotated or tilted view - the compass reset
    // button is hidden below precisely because rotation was never meant to
    // be reachable, and there'd be no way back from an accidental one
    // anyway. A real two-finger pinch rarely stays perfectly on-axis
    // though, so without this, an ordinary pinch-zoom (especially zooming
    // out, where fingers travel further) can pick up a bit of stray
    // rotation or vertical drift that MapLibre reads as "rotate" or "tilt
    // to pitch" - reported as the map "going haywire" after zooming out of
    // a followed vehicle.
    dragRotate: false,
    touchPitch: false,
  });
  // TouchZoomRotateHandler's own rotation-disabled flag survives the
  // disable()/enable() cycling setFollowingVehicle() below does for the
  // zoom-anchor toggle (enable() only re-arms rotation if it wasn't
  // disabled) - so this only needs to run once, not on every toggle.
  map.touchZoomRotate.disableRotation();

  // MapLibre's own compact attribution is expanded by default regardless
  // of any constructor option, per its own docs, and only auto-collapses
  // once the map is moved. It's a native <details>/<summary> pair, but its
  // own click handler (_toggleAttribution in maplibre-gl's source) tracks
  // open/closed purely via the maplibregl-compact-show class on the
  // container - not the native `open` attribute/property, which turned out
  // to be unrelated to what's actually visible (an earlier version of this
  // fix targeted `open` and did nothing real). Removing that class is what
  // the CSS (`.compact-show .ctrl-attrib-inner{display:block}` vs.
  // `.compact .ctrl-attrib-inner{display:none}`) actually keys off.
  // Removing it once right after construction isn't enough either:
  // MapLibre re-adds it itself while rebuilding the attribution text as
  // sources load in, so this keeps removing it until the map settles -
  // both right after construction and again after each theme switch's own
  // style/source reload.
  function suppressAutoOpenAttribution() {
    if (!map) return;
    const attribution = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
    if (!attribution) return;
    const SHOW_CLASS = 'maplibregl-compact-show';
    attribution.classList.remove(SHOW_CLASS);
    const observer = new MutationObserver(() => {
      if (attribution.classList.contains(SHOW_CLASS)) attribution.classList.remove(SHOW_CLASS);
    });
    observer.observe(attribution, { attributes: true, attributeFilter: ['class'] });
    // A real click on the toggle should win immediately, not fight the
    // observer until the timeout below - disconnect() is safe to call
    // more than once (from here and/or the timeout). MapLibre's own click
    // handler on the summary runs first (adds the class back since we just
    // removed it) and bubbles to this listener on the container afterward,
    // so the observer is already gone before it would otherwise undo that.
    attribution.addEventListener('click', () => observer.disconnect(), { once: true });
    // map.once('idle', ...) sounds like the right hook to disconnect on,
    // but never actually fires here: renderInterpolatedFrame() calls the
    // vehicle source's setData() every animation frame, so the map is
    // never truly idle - that left the observer fighting every click
    // forever, making the control impossible to ever open. A flat timeout
    // instead; testing showed MapLibre's own reopen cycles settle well
    // before this.
    setTimeout(() => observer.disconnect(), 3000);
  }
  suppressAutoOpenAttribution();

  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
  const geolocateControl = new GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    // Continuous tracking, not a single jump: the accuracy circle only
    // narrows down to a point as the fix improves if position updates keep
    // arriving (a one-shot getCurrentPosition() gives a single static
    // reading, nothing to narrow from). This does mean GeolocateControl's
    // own recenter-on-each-update could in principle fight the per-frame
    // setCenter() below if a vehicle got followed *while* still actively
    // tracking - not handled here, since the reverse (already tracking,
    // then selecting a vehicle) is the same class of two-camera-owners
    // conflict and isn't guarded against either.
    trackUserLocation: true,
    showUserLocation: true,
    showAccuracyCircle: true,
    // Default maxZoom is 15 - bumped to 16 to match the zoom a favorite
    // stop's own "locate" flyTo already uses elsewhere in this file, so
    // every "jump to a point" interaction lands at the same closeness.
    fitBoundsOptions: { maxZoom: 16 },
  });
  map.addControl(geolocateControl, 'bottom-right');
  // Jumping to the viewer's own location is a deliberate "go somewhere
  // else" action, same as a drag - shouldn't leave the camera fighting a
  // still-followed vehicle's per-frame recenter. Fired on the control
  // itself, not the map - GeolocateControl's own event, not one of
  // MapLibre's map-level ones.
  geolocateControl.on('geolocate', () => {
    setFollowingVehicle(false);
  });

  // Only an actual pan drag releases the follow - zooming (wheel, pinch,
  // +/- buttons) stays anchored on the vehicle so you can zoom in on it
  // while it keeps moving, which is the whole point of following it.
  map.on('dragstart', () => {
    // A two-finger pinch with any lateral drift - which real fingers always
    // have some of - gets misclassified by MapLibre's own gesture-conflict
    // resolution as also including a drag, so dragstart fires mid-pinch.
    // Reacting to that by disable()/enable()-cycling touchZoomRotate below
    // (via setFollowingVehicle) resets the in-progress pinch recognition
    // entirely, freezing zoom for the rest of that gesture - reproduced
    // with a CDP-dispatched pinch that translates sideways while
    // converging: zoom stayed frozen at its starting value even though the
    // center moved. multiTouchActive (tracked below) means a pinch is still
    // down, so this is a real single-finger drag, not that misclassification.
    if (multiTouchActive) return;
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

  // iOS Safari fires its own proprietary gesturestart/change/end events for
  // a two-finger pinch, separate from (and alongside) the touch events
  // MapLibre already handles for its own pinch-zoom - and, since ~iOS 10,
  // doesn't reliably honor the viewport's user-scalable=no for them either.
  // Without blocking these too, a pinch on the map fights Safari's own
  // native page-zoom the whole time it's held. A no-op everywhere else -
  // no other browser fires these. (preventSafariGesture is declared at
  // module scope above so onUnmounted can remove the exact same reference.)
  document.addEventListener('gesturestart', preventSafariGesture);
  document.addEventListener('gesturechange', preventSafariGesture);
  document.addEventListener('gestureend', preventSafariGesture);

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
  // re-adds ours. The click/hover handlers set up by setupInteractionsAndWatchers()
  // aren't re-registered here - they're pure event delegation keyed by layer
  // ID, not references to the removed layer objects, so they keep working
  // against the layers addMapLayers() re-creates. The sources those layers
  // draw from come back empty though, and the prop watchers that normally
  // fill them only do so on a prop *change* (their `immediate: true` only
  // ever covers the very first setup) - so favorite stops, any drawn route
  // path, and the always-on nearby-stop markers each need an explicit push
  // back in below, or they'd stay empty until something else happens to
  // change those props again (previously reported as needing a full page
  // reload to come back after a theme toggle).
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
        void (async () => {
          await addMapLayers();
          suppressAutoOpenAttribution();
          syncFavoriteStopsSource();
          syncRoutePathSource();
          scheduleStopsFetch();
          // Reuse "Herääminen" for a theme switch too: every tracked vehicle
          // re-appears from appearProgress 0 instead of popping back in
          // instantly once the vehicle layer above is re-added. The next HFP
          // flush (the props.vehicles watcher below, within FLUSH_INTERVAL_MS)
          // treats them all as newly arrived and restaggers the fade-in across
          // WAKE_WINDOW_MS, same as the very first load.
          appearStart.clear();
          hasReceivedFirstFlush = false;
        })();
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

  // Pushes the current favorite stops / selected route path into the map's
  // sources. Called both by their own prop watchers below (so a change
  // while the map is open updates live) and, on their own, right after a
  // theme switch's addMapLayers() rebuilds those sources empty - the
  // watchers' `immediate: true` only covers their first-ever setup, not a
  // later source replacement, so without this a theme toggle silently wipes
  // favorite stops and any drawn route path until something else happens to
  // change those props again (or the page is reloaded).
  function syncFavoriteStopsSource() {
    if (!map) return;
    // eslint's type resolution doesn't pick up GeoJSONSource here, unlike vue-tsc.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const stopsSource = map.getSource(FAVORITE_STOPS_SOURCE_ID) as GeoJSONSource | undefined;
    void stopsSource?.setData({
      type: 'FeatureCollection',
      features: props.favoriteStops.map((stop) => ({
        type: 'Feature',
        properties: { gtfsId: stop.gtfsId, name: stop.name, code: stop.code, mode: stop.mode },
        geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
      })),
    });
  }

  function syncRoutePathSource() {
    if (!map) return;
    // eslint's type resolution doesn't pick up GeoJSONSource here, unlike vue-tsc.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const routeSource = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
    void routeSource?.setData({
      type: 'FeatureCollection',
      features: props.routePaths.map((path) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: path },
      })),
    });
    const lineColor = props.routeColor ?? ROUTE_DEFAULT_COLOR;
    map.setPaintProperty(ROUTE_GLOW_LAYER_ID, 'line-color', lineColor);
    map.setPaintProperty(ROUTE_LINE_LAYER_ID, 'line-color', lineColor);
  }

  // Also moved out to this same reusable scope, for the same reason - the
  // always-on nearby-stop markers otherwise stay empty after a theme switch
  // until the next pan/zoom happens to fire 'moveend' on its own.
  function scheduleStopsFetch() {
    if (!map) return;
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

  // Everything below is pure event delegation and prop watching. The click/
  // hover handlers are keyed by layer ID, not tied to any specific layer
  // object, so they keep working across addMapLayers() re-adding layers
  // after a style change without needing to be re-registered - but the
  // prop watchers' own `immediate: true` only fires once, at this initial
  // setup, so re-populating their sources after a later style change is the
  // theme watcher's job above, via the sync functions just above.
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
        const p = stopHit.properties as {
          gtfsId: string;
          name: string;
          code: string | null;
          mode: string;
        };
        const [lon, lat] = stopHit.geometry.coordinates;
        selectStop({ gtfsId: p.gtfsId, name: p.name, code: p.code, lat, lon }, p.mode);
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
        () => syncRoutePathSource(),
        { immediate: true },
      ),
    );

    watcherStops.push(
      watch(
        () => props.favoriteStops,
        () => syncFavoriteStopsSource(),
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

    map.on('moveend', () => {
      // See programmaticCenterUpdate's own comment above - a moveend fired
      // by the per-frame vehicle-follow setCenter(), not a real camera move,
      // shouldn't reset the nearby-stop fetch's debounce.
      if (programmaticCenterUpdate) return;
      scheduleStopsFetch();
    });
  }
});

onUnmounted(() => {
  if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
  clearTimeout(stopsFetchTimer);
  clearInterval(departuresRefreshTimer);
  for (const stop of watcherStops) stop();
  document.removeEventListener('gesturestart', preventSafariGesture);
  document.removeEventListener('gesturechange', preventSafariGesture);
  document.removeEventListener('gestureend', preventSafariGesture);
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
      :alerts="stopAlerts"
      :position="selectedStopPosition"
      :is-favorite="isSelectedStopFavorite"
      @close="deselectStop"
      @toggle-favorite="toggleSelectedStopFavorite"
      @locate-route="locateVehicleOnRoute"
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

/* MapLibre's own zoom/geolocate controls (NavigationControl,
   GeolocateControl) are added 'bottom-right' inside .pulse-map, which fills
   the same area the collapsed mobile sheet (AppSidebar.vue) sits fixed on
   top of - without this they'd render partly hidden behind it. MapLibre's
   control classes aren't part of this component's own markup, so :global()
   is needed to reach them past scoped-style hashing. Only clears the
   *collapsed* sheet - fully expanded (78vh), the controls are meant to be
   out of the way while the list has focus. */
@media (max-width: 720px) {
  .pulse-map :global(.maplibregl-ctrl-bottom-right) {
    bottom: var(--mobile-sheet-collapsed-height);
  }
}
</style>
