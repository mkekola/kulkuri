<script setup lang="ts">
import type { VehicleProperties } from '../lib/hfp';
import { modeColor, modeLabel } from '../lib/vehicleModes';

defineProps<{ vehicle: VehicleProperties }>();
defineEmits<{ close: [] }>();

function speedKmh(spd: number | null): string {
  if (spd == null) return '–';
  return `${Math.round(spd * 3.6)} km/h`;
}
</script>

<template>
  <div class="vehicle-detail">
    <span class="badge" :style="{ background: modeColor(vehicle.mode) }">
      {{ vehicle.line ?? vehicle.route ?? '–' }}
    </span>
    <span class="mode">{{ modeLabel(vehicle.mode) }}</span>
    <span class="speed">{{ speedKmh(vehicle.speed) }}</span>
    <button class="close" type="button" aria-label="Sulje" @click="$emit('close')">×</button>
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
  align-items: center;
  gap: 12px;
  background: rgba(18, 26, 44, 0.92);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(233, 237, 244, 0.12);
  border-radius: 16px;
  padding: 12px 14px;
  color: #e9edf4;
  font-family: system-ui, sans-serif;
}

.badge {
  font-weight: 700;
  font-size: 13px;
  padding: 5px 14px;
  border-radius: 999px;
  color: #0a0f1c;
  min-width: 24px;
  text-align: center;
}

.mode {
  font-size: 13px;
  color: #8c96b3;
}

.speed {
  margin-left: auto;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.close {
  background: none;
  border: none;
  color: #8c96b3;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  padding: 4px 8px;
}

.close:hover,
.close:focus-visible {
  color: #e9edf4;
}
</style>
