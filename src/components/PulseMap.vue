<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef } from 'vue';
import { Map, NavigationControl, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { connectVehiclePositions } from '../lib/hfp';
import type { FeatureCollection, Point } from 'geojson';

const HELSINKI_CENTER: [number, number] = [24.9414, 60.1719];
const VEHICLES_SOURCE_ID = 'vehicles';

const emptyCollection: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };

const mapContainer = useTemplateRef<HTMLDivElement>('mapContainer');
let map: Map | undefined;
let disconnect: (() => void) | undefined;

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
      id: 'vehicles-layer',
      type: 'circle',
      source: VEHICLES_SOURCE_ID,
      paint: {
        'circle-radius': 5,
        'circle-color': [
          'match',
          ['get', 'mode'],
          'bus',
          '#007ac9',
          'tram',
          '#00985f',
          'train',
          '#8c4799',
          'metro',
          '#ff6319',
          'ferry',
          '#00b9e4',
          '#9a9a9a',
        ],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
        'circle-opacity': 0.9,
      },
    });

    disconnect = connectVehiclePositions((features) => {
      // eslint's type resolution doesn't pick up GeoJSONSource here, unlike vue-tsc.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      const source = map?.getSource(VEHICLES_SOURCE_ID) as GeoJSONSource | undefined;
      void source?.setData(features);
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
</template>

<style scoped>
.pulse-map {
  position: absolute;
  inset: 0;
}
</style>
