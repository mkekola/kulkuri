<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef } from 'vue';
import { Map, NavigationControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const HELSINKI_CENTER: [number, number] = [24.9414, 60.1719];

const mapContainer = useTemplateRef<HTMLDivElement>('mapContainer');
let map: Map | undefined;

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
});

onUnmounted(() => {
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
