<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { VehicleProperties } from '../lib/hfp';
import { modeColor, modeLabel } from '../lib/vehicleModes';
import { fetchRouteEndpoints, type RouteEndpoints } from '../lib/digitransit';

const props = defineProps<{ vehicle: VehicleProperties }>();
defineEmits<{ close: [] }>();

const endpointsByDirection = ref<Record<number, RouteEndpoints> | null>(null);

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
  <div class="vehicle-detail">
    <div class="row">
      <span class="badge" :style="{ background: modeColor(vehicle.mode) }">
        {{ vehicle.line ?? vehicle.route ?? '–' }}
      </span>
      <span class="mode">{{ modeLabel(vehicle.mode) }}</span>
      <span class="speed">{{ speedKmh(vehicle.speed) }}</span>
      <button class="close" type="button" aria-label="Sulje" @click="$emit('close')">×</button>
    </div>
    <div v-if="endpoints" class="route-text">
      {{ endpoints.origin }} – {{ endpoints.destination }}
    </div>
  </div>
</template>

<style scoped>
.vehicle-detail {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 16px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--surface-translucent);
  backdrop-filter: blur(6px);
  border: 1px solid var(--line-strong);
  border-radius: 16px;
  padding: 12px 14px;
  color: var(--text);
  font-family: var(--font-body);
}

/* Clears the collapsed mobile sidebar bar (AppSidebar.vue) sitting at the
   very bottom below this breakpoint. */
@media (max-width: 720px) {
  .vehicle-detail {
    bottom: 116px;
  }
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
