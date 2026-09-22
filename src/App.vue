<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import PulseMap from './components/PulseMap.vue';
import AppSidebar from './components/AppSidebar.vue';
import { useVehiclePositions } from './composables/useVehiclePositions';
import { useFavorites, type FavoriteStop } from './composables/useFavorites';
import { fetchRoutePaths, type RoutePath } from './lib/digitransit';
import { modeColor } from './lib/vehicleModes';

const { vehicles } = useVehiclePositions();
const { favoriteLines, favoriteStops, toggleFavoriteLine, addFavoriteStop, removeFavoriteStop } =
  useFavorites();
const activeMode = ref('all');
const selectedRoute = ref<string | null>(null);
const routePaths = shallowRef<RoutePath[]>([]);
const locateRequest = shallowRef<{ stop: FavoriteStop; nonce: number } | null>(null);
let locateNonce = 0;
const focusRouteRequest = shallowRef<{ nonce: number } | null>(null);
let focusRouteNonce = 0;
// Picking a line from the sidebar should frame it on the map; picking it by
// tapping a vehicle marker there shouldn't - that already centers on the
// vehicle itself, and re-framing to the whole route would fight that.
let focusOnNextRoutePaths = false;

const selectedRouteColor = computed(() => {
  if (!selectedRoute.value) return null;
  for (const feature of vehicles.value.values()) {
    if (feature.properties.route === selectedRoute.value) return modeColor(feature.properties.mode);
  }
  return null;
});

watch(selectedRoute, async (route) => {
  const shouldFocus = focusOnNextRoutePaths;
  focusOnNextRoutePaths = false;
  if (!route) {
    routePaths.value = [];
    return;
  }
  const requested = route;
  const paths = await fetchRoutePaths(route);
  // Ignore the response if the selection moved on while the request was in flight.
  if (selectedRoute.value !== requested) return;
  routePaths.value = paths;
  if (shouldFocus) {
    focusRouteNonce += 1;
    focusRouteRequest.value = { nonce: focusRouteNonce };
  }
});

function selectLineFromSidebar(route: string | null) {
  if (route) focusOnNextRoutePaths = true;
  selectedRoute.value = route;
}

function locateStop(stop: FavoriteStop) {
  locateNonce += 1;
  locateRequest.value = { stop, nonce: locateNonce };
}
</script>

<template>
  <div class="app-shell">
    <AppSidebar
      :vehicles="vehicles"
      :active-mode="activeMode"
      :selected-route="selectedRoute"
      :favorite-lines="favoriteLines"
      :favorite-stops="favoriteStops"
      @update:active-mode="activeMode = $event"
      @select-line="selectLineFromSidebar"
      @toggle-favorite-line="toggleFavoriteLine"
      @add-favorite-stop="addFavoriteStop"
      @remove-favorite-stop="removeFavoriteStop"
      @locate-stop="locateStop"
    />
    <div class="map-area">
      <PulseMap
        :vehicles="vehicles"
        :active-mode="activeMode"
        :route-paths="routePaths"
        :route-color="selectedRouteColor"
        :favorite-stops="favoriteStops"
        :locate-request="locateRequest"
        :focus-route-request="focusRouteRequest"
        @select-route="selectedRoute = $event"
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
