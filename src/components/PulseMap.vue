<script setup lang="ts">
import { onMounted, onUnmounted, ref, useTemplateRef } from 'vue';
import {
  Map,
  NavigationControl,
  type DataDrivenPropertyValueSpecification,
  type GeoJSONSource,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { connectVehiclePositions, type VehicleProperties } from '../lib/hfp';
import { DEFAULT_MODE_COLOR, MODE_COLORS } from '../lib/vehicleModes';
import VehicleDetail from './VehicleDetail.vue';
import type { FeatureCollection, Point } from 'geojson';

const HELSINKI_CENTER: [number, number] = [24.9414, 60.1719];
const VEHICLES_SOURCE_ID = 'vehicles';
const VEHICLES_LAYER_ID = 'vehicles-layer';

const emptyCollection: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };

const mapContainer = useTemplateRef<HTMLDivElement>('mapContainer');
const selectedVehicle = ref<VehicleProperties | null>(null);
let map: Map | undefined;
let disconnect: (() => void) | undefined;

function deselectVehicle() {
  selectedVehicle.value = null;
}

onMounted(() => {
  if (!mapContainer.value) return;

  map = new Map({
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

    disconnect = connectVehiclePositions((features) => {
      // eslint's type resolution doesn't pick up GeoJSONSource here, unlike vue-tsc.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      const source = map?.getSource(VEHICLES_SOURCE_ID) as GeoJSONSource | undefined;
      void source?.setData(features);

      if (selectedVehicle.value) {
        const stillPresent = features.features.find(
          (f) => f.properties.vehicleId === selectedVehicle.value?.vehicleId,
        );
        selectedVehicle.value = stillPresent?.properties ?? null;
      }
    });
  });
});

onUnmounted(() => {
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
