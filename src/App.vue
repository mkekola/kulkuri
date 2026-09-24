<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import PulseMap from './components/PulseMap.vue';
import AppSidebar from './components/AppSidebar.vue';
import { useVehiclePositions } from './composables/useVehiclePositions';
import { useFavorites, type FavoriteStop } from './composables/useFavorites';
import { useTheme } from './composables/useTheme';
import { useTrunkRoutes } from './composables/useTrunkRoutes';
import { fetchRoutePaths, type RoutePath } from './lib/digitransit';
import { badgeColor } from './lib/vehicleModes';

const { theme, toggleTheme } = useTheme();
const { vehicles } = useVehiclePositions();
const { favoriteLines, favoriteStops, toggleFavoriteLine, addFavoriteStop, removeFavoriteStop } =
  useFavorites();
const trunkRouteIds = useTrunkRoutes();
const activeMode = ref('all');
const selectedRoute = ref<string | null>(null);
// Captured only when a line is picked from the sidebar (a vehicle click
// always has a live vehicle to read the mode off directly) - lets a route
// with no vehicle on it right now still draw in its real mode color below,
// instead of falling back to the generic route-default orange.
const selectedRouteMode = ref<string | null>(null);
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
  const isTrunk = trunkRouteIds.value.has(selectedRoute.value);
  for (const feature of vehicles.value.values()) {
    if (feature.properties.route === selectedRoute.value) {
      return badgeColor(feature.properties.mode, isTrunk);
    }
  }
  return selectedRouteMode.value ? badgeColor(selectedRouteMode.value, isTrunk) : null;
});

watch(selectedRoute, async (route) => {
  const shouldFocus = focusOnNextRoutePaths;
  focusOnNextRoutePaths = false;
  if (!route) {
    routePaths.value = [];
    selectedRouteMode.value = null;
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

function selectLineFromSidebar(route: string | null, mode: string | null) {
  if (route) focusOnNextRoutePaths = true;
  selectedRoute.value = route;
  selectedRouteMode.value = mode;
}

function locateStop(stop: FavoriteStop) {
  locateNonce += 1;
  locateRequest.value = { stop, nonce: locateNonce };
}

function selectRouteFromMap(route: string | null) {
  // A vehicle click always has a live vehicle to read the color off, so
  // selectedRouteColor's own lookup covers it - this only needs to drop any
  // stale sidebar-picked mode so it doesn't linger past the selection that
  // set it.
  selectedRouteMode.value = null;
  selectedRoute.value = route;
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
      :theme="theme"
      @update:active-mode="activeMode = $event"
      @select-line="selectLineFromSidebar"
      @toggle-theme="toggleTheme"
      @toggle-favorite-line="toggleFavoriteLine"
      @add-favorite-stop="addFavoriteStop"
      @remove-favorite-stop="removeFavoriteStop"
      @locate-stop="locateStop"
    />
    <div class="map-area">
      <PulseMap
        :vehicles="vehicles"
        :active-mode="activeMode"
        :selected-route="selectedRoute"
        :route-paths="routePaths"
        :route-color="selectedRouteColor"
        :favorite-stops="favoriteStops"
        :locate-request="locateRequest"
        :focus-route-request="focusRouteRequest"
        @select-route="selectRouteFromMap"
        @add-favorite-stop="addFavoriteStop"
        @remove-favorite-stop="removeFavoriteStop"
      />
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  width: 100vw;
  height: 100vh;
  background: var(--bg);
}

.map-area {
  position: relative;
  flex: 1;
  padding: 14px;
}
</style>
