<script setup lang="ts">
import { onMounted, onUnmounted, ref, useTemplateRef } from 'vue';
import {
  Map as MaplibreMap,
  NavigationControl,
  type DataDrivenPropertyValueSpecification,
  type GeoJSONSource,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { connectVehiclePositions, FLUSH_INTERVAL_MS, type VehicleProperties } from '../lib/hfp';
import { DEFAULT_MODE_COLOR, MODE_COLORS } from '../lib/vehicleModes';
import VehicleDetail from './VehicleDetail.vue';
import type { Feature, FeatureCollection, Point } from 'geojson';

const HELSINKI_CENTER: [number, number] = [24.9414, 60.1719];
const VEHICLES_SOURCE_ID = 'vehicles';
const VEHICLES_LAYER_ID = 'vehicles-layer';

const emptyCollection: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };

const mapContainer = useTemplateRef<HTMLDivElement>('mapContainer');
const selectedVehicle = ref<VehicleProperties | null>(null);
let map: MaplibreMap | undefined;
let disconnect: (() => void) | undefined;
let animationFrame: number | undefined;

// Vehicles glide from their previous position to the latest HFP fix instead of
// jumping once a second: `previous` holds where each vehicle was heading before
// the last update, `target` holds the latest known feature for each vehicle.
const previous = new Map<string, [number, number]>();
const target = new Map<string, Feature<Point, VehicleProperties>>();
let lastFlushAt = performance.now();

function renderInterpolatedFrame(source: GeoJSONSource | undefined) {
  const t = Math.min(1, (performance.now() - lastFlushAt) / FLUSH_INTERVAL_MS);
  const features: Feature<Point, VehicleProperties>[] = [];

  for (const [vehicleId, feature] of target) {
    const [lon, lat] = feature.geometry.coordinates;
    const [fromLon, fromLat] = previous.get(vehicleId) ?? [lon, lat];
    features.push({
      ...feature,
      geometry: {
        type: 'Point',
        coordinates: [fromLon + (lon - fromLon) * t, fromLat + (lat - fromLat) * t],
      },
    });
  }

  void source?.setData({ type: 'FeatureCollection', features });
  animationFrame = requestAnimationFrame(() => renderInterpolatedFrame(source));
}

function deselectVehicle() {
  selectedVehicle.value = null;
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

    map.addSource(VEHICLES_SOURCE_ID, { type: 'geojson', data: emptyCollection });

    map.addLayer({
      id: VEHICLES_LAYER_ID,
      type: 'circle',
      source: VEHICLES_SOURCE_ID,
      paint: {
        'circle-radius': 5,
        'circle-color': [
          'match',
          ['get', 'mode'],
          ...Object.entries(MODE_COLORS).flat(),
          DEFAULT_MODE_COLOR,
        ] as unknown as DataDrivenPropertyValueSpecification<string>,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
        'circle-opacity': 0.9,
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
      selectedVehicle.value = (feature?.properties as VehicleProperties | undefined) ?? null;
    });

    // eslint's type resolution doesn't pick up GeoJSONSource here, unlike vue-tsc.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const source = map.getSource(VEHICLES_SOURCE_ID) as GeoJSONSource | undefined;
    animationFrame = requestAnimationFrame(() => renderInterpolatedFrame(source));

    disconnect = connectVehiclePositions((features) => {
      for (const [vehicleId, feature] of target) {
        const [lon, lat] = feature.geometry.coordinates;
        previous.set(vehicleId, [lon, lat]);
      }
      target.clear();
      for (const feature of features.features) {
        target.set(feature.properties.vehicleId, feature);
      }
      lastFlushAt = performance.now();

      if (selectedVehicle.value) {
        selectedVehicle.value = target.get(selectedVehicle.value.vehicleId)?.properties ?? null;
      }
    });
  });
});

onUnmounted(() => {
  if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
  disconnect?.();
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
}
</style>
