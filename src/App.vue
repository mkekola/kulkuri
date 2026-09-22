<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import PulseMap from './components/PulseMap.vue';
import AppSidebar from './components/AppSidebar.vue';
import { useVehiclePositions } from './composables/useVehiclePositions';
import { fetchRoutePaths, type RoutePath } from './lib/digitransit';
import { modeColor } from './lib/vehicleModes';

const { vehicles } = useVehiclePositions();
const activeMode = ref('all');
const selectedRoute = ref<string | null>(null);
const routePaths = shallowRef<RoutePath[]>([]);

const selectedRouteColor = computed(() => {
  if (!selectedRoute.value) return null;
  for (const feature of vehicles.value.values()) {
    if (feature.properties.route === selectedRoute.value) return modeColor(feature.properties.mode);
  }
  return null;
});

watch(selectedRoute, async (route) => {
  if (!route) {
    routePaths.value = [];
    return;
  }
  const requested = route;
  const paths = await fetchRoutePaths(route);
  // Ignore the response if the selection moved on while the request was in flight.
  if (selectedRoute.value === requested) routePaths.value = paths;
});
</script>

<template>
  <div class="app-shell">
    <AppSidebar
      :vehicles="vehicles"
      :active-mode="activeMode"
      :selected-route="selectedRoute"
      @update:active-mode="activeMode = $event"
      @select-line="selectedRoute = $event"
    />
    <div class="map-area">
      <PulseMap
        :vehicles="vehicles"
        :active-mode="activeMode"
        :route-paths="routePaths"
        :route-color="selectedRouteColor"
      />
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  width: 100vw;
  height: 100vh;
  background: #0a0f1c;
}

.map-area {
  position: relative;
  flex: 1;
  padding: 14px;
}
</style>
