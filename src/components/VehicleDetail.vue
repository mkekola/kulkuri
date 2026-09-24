<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { VehicleProperties } from '../lib/hfp';
import { badgeColor, modeLabel } from '../lib/vehicleModes';
import { fetchRouteEndpoints, type RouteEndpoints } from '../lib/digitransit';
import type { AnchoredPosition } from '../lib/anchoredPopup';
import { useTrunkRoutes } from '../composables/useTrunkRoutes';
import { formatDelay } from '../lib/departureTime';

const props = defineProps<{ vehicle: VehicleProperties; position: AnchoredPosition }>();
defineEmits<{ close: [] }>();

const endpointsByDirection = ref<Record<number, RouteEndpoints> | null>(null);
const trunkRouteIds = useTrunkRoutes();

watch(
  () => props.vehicle.route,
  (route) => {
    endpointsByDirection.value = null;
    if (!route) return;
    const requested = route;
    void fetchRouteEndpoints(requested).then((result) => {
      if (props.vehicle.route === requested) endpointsByDirection.value = result;
    });
  },
  { immediate: true },
);

// HSL's HFP "dir" is "1"/"2"; GTFS direction_id (what Digitransit's patterns
// use) is the same thing 0-indexed.
const directionId = computed(() => {
  if (props.vehicle.dir === '1') return 0;
  if (props.vehicle.dir === '2') return 1;
  return null;
});

const endpoints = computed(() =>
  directionId.value != null ? (endpointsByDirection.value?.[directionId.value] ?? null) : null,
);

function speedKmh(spd: number | null): string {
  if (spd == null) return '–';
  return `${Math.round(spd * 3.6)} km/h`;
}
</script>

<template>
  <div
    class="vehicle-detail"
    :class="position.placement"
    :style="{ left: `${position.left}px`, top: `${position.top}px`, width: `${position.width}px` }"
  >
    <div class="tail" :style="{ left: `${position.tailOffset}px` }" aria-hidden="true"></div>
    <div class="row">
      <span
        class="badge"
        :style="{
          background: badgeColor(vehicle.mode, vehicle.route != null && trunkRouteIds.has(vehicle.route)),
        }"
      >
        {{ vehicle.line ?? vehicle.route ?? '–' }}
      </span>
      <span class="mode">{{ modeLabel(vehicle.mode) }}</span>
      <span v-if="formatDelay(vehicle.delay)" class="delay" :class="{ late: (vehicle.delay ?? 0) >= 60 }">
        {{ formatDelay(vehicle.delay) }}
      </span>
      <span class="speed">{{ speedKmh(vehicle.speed) }}</span>
      <button class="close" type="button" aria-label="Sulje" @click="$emit('close')">×</button>
    </div>
    <div v-if="endpoints" class="route-text">
      {{ endpoints.origin }} – {{ endpoints.destination }}
    </div>
  </div>
</template>

<style scoped>
/* Anchored next to the clicked vehicle on the map (left/top/width are set
   inline from anchoredPositionAt() in PulseMap.vue) instead of stretching
   across the whole map like the old bottom bar. .above sits above the
   marker (shifted up by its own height via transform, since that height
   isn't known ahead of render) and .below sits under it when there's not
   enough room above. */
.vehicle-detail {
  position: absolute;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--surface-translucent);
  backdrop-filter: blur(6px);
  border: 1px solid var(--line-strong);
  border-radius: 14px;
  padding: 12px 14px;
  color: var(--text);
  font-family: var(--font-body);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
}

.vehicle-detail.above {
  transform: translateY(-100%);
}

/* A rotated square, half tucked under the card's edge - the classic
   tooltip-tail trick. Two of its four borders are hidden so only the outer
   corner reads as a triangle pointing at the marker. */
.tail {
  position: absolute;
  width: 14px;
  height: 14px;
  background: var(--surface-translucent);
  backdrop-filter: blur(6px);
  transform: translateX(-50%) rotate(45deg);
}

.vehicle-detail.above .tail {
  bottom: -8px;
  border-right: 1px solid var(--line-strong);
  border-bottom: 1px solid var(--line-strong);
}

.vehicle-detail.below .tail {
  top: -8px;
  border-left: 1px solid var(--line-strong);
  border-top: 1px solid var(--line-strong);
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.badge {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 13px;
  padding: 5px 14px;
  border-radius: 999px;
  color: var(--on-fill);
  min-width: 24px;
  text-align: center;
}

.mode {
  font-size: 13px;
  color: var(--muted);
}

.delay {
  font-size: 13px;
  color: var(--muted);
}

.delay.late {
  color: var(--accent-text);
}

.speed {
  font-family: var(--font-mono);
  margin-left: auto;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.route-text {
  font-size: 13px;
  color: var(--text);
  padding-left: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close {
  background: none;
  border: none;
  color: var(--muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  padding: 4px 8px;
  margin: -4px -8px -4px 0;
}

.close:hover,
.close:focus-visible {
  color: var(--text);
}
</style>
