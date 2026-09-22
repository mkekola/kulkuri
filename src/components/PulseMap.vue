<script setup lang="ts">
import { onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import {
  Map as MaplibreMap,
  NavigationControl,
  type DataDrivenPropertyValueSpecification,
  type GeoJSONSource,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { VehicleMap } from '../composables/useVehiclePositions';
import { DEFAULT_MODE_COLOR, MODE_COLORS } from '../lib/vehicleModes';
import type { VehicleProperties } from '../lib/hfp';
import { FLUSH_INTERVAL_MS } from '../lib/hfp';
import type { RoutePath } from '../lib/digitransit';
import VehicleDetail from './VehicleDetail.vue';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';

const props = defineProps<{
  vehicles: VehicleMap;
  activeMode: string;
  routePaths: RoutePath[];
  routeColor: string | null;
}>();
const emit = defineEmits<{ 'select-route': [route: string | null] }>();

const HELSINKI_CENTER: [number, number] = [24.9414, 60.1719];
const VEHICLES_SOURCE_ID = 'vehicles';
const VEHICLES_LAYER_ID = 'vehicles-layer';
const ROUTE_SOURCE_ID = 'route-path';
const ROUTE_GLOW_LAYER_ID = 'route-path-glow';
const ROUTE_LINE_LAYER_ID = 'route-path-line';
const ROUTE_DEFAULT_COLOR = '#ff7a45';

const emptyCollection: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };
const emptyLineCollection: FeatureCollection<LineString> = {
  type: 'FeatureCollection',
  features: [],
};

const mapContainer = useTemplateRef<HTMLDivElement>('mapContainer');
const selectedVehicle = ref<VehicleProperties | null>(null);
let map: MaplibreMap | undefined;
let animationFrame: number | undefined;

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

function renderInterpolatedFrame(source: GeoJSONSource | undefined) {
  const now = performance.now();
  const t = Math.min(1, (now - lastFlushAt) / FLUSH_INTERVAL_MS);
  const features: Feature<Point, VehicleProperties & { appearProgress: number }>[] = [];

  for (const [vehicleId, feature] of target) {
    if (!visible(feature)) continue;
    const [lon, lat] = feature.geometry.coordinates;
    const [fromLon, fromLat] = previous.get(vehicleId) ?? [lon, lat];
    features.push({
      ...feature,
      properties: { ...feature.properties, appearProgress: appearProgressAt(vehicleId, now) },
      geometry: {
        type: 'Point',
        coordinates: [fromLon + (lon - fromLon) * t, fromLat + (lat - fromLat) * t],
      },
    });
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
    attributionControl: { compact: true },
  });

  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');

  map.on('load', () => {
    if (!map) return;

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
          5,
          ['get', 'appearProgress'],
        ] as unknown as DataDrivenPropertyValueSpecification<number>,
        'circle-color': [
          'match',
          ['get', 'mode'],
          ...Object.entries(MODE_COLORS).flat(),
          DEFAULT_MODE_COLOR,
        ] as unknown as DataDrivenPropertyValueSpecification<string>,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
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

    map.on('mouseenter', VEHICLES_LAYER_ID, () => {
      if (map) map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', VEHICLES_LAYER_ID, () => {
      if (map) map.getCanvas().style.cursor = '';
    });
    map.on('click', (e) => {
      const [feature] = map?.queryRenderedFeatures(e.point, { layers: [VEHICLES_LAYER_ID] }) ?? [];
      const properties = (feature?.properties as VehicleProperties | undefined) ?? null;
      selectedVehicle.value = properties;
      emit('select-route', properties?.route ?? null);
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
  });
});

onUnmounted(() => {
  if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
  map?.remove();
});
</script>

<template>
  <div ref="mapContainer" class="pulse-map" />
  <VehicleDetail v-if="selectedVehicle" :vehicle="selectedVehicle" @close="deselectVehicle" />
</template>

<style scoped>
.pulse-map {
  position: absolute;
  inset: 0;
  border-radius: 16px;
  overflow: hidden;
}
</style>
