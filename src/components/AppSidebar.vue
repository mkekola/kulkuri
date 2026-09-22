<script setup lang="ts">
import { computed } from 'vue';
import type { VehicleMap } from '../composables/useVehiclePositions';
import { modeColor, modeLabel } from '../lib/vehicleModes';

const props = defineProps<{ vehicles: VehicleMap; activeMode: string }>();
const emit = defineEmits<{ 'update:activeMode': [mode: string] }>();

const MODES = ['all', 'bus', 'tram', 'metro', 'train', 'ferry'];

interface LineRow {
  key: string;
  line: string;
  mode: string;
  count: number;
}

const lines = computed<LineRow[]>(() => {
  const byLine = new Map<string, LineRow>();
  for (const feature of props.vehicles.values()) {
    const { mode, line, route } = feature.properties;
    if (props.activeMode !== 'all' && mode !== props.activeMode) continue;
    const label = line ?? route ?? '–';
    const key = `${mode}/${label}`;
    const existing = byLine.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      byLine.set(key, { key, line: label, mode, count: 1 });
    }
  }
  return Array.from(byLine.values()).sort((a, b) => b.count - a.count);
});

function modeChipLabel(mode: string): string {
  return mode === 'all' ? 'Kaikki' : modeLabel(mode);
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-head">Kulkuri</div>
    <div class="chips">
      <button
        v-for="mode in MODES"
        :key="mode"
        type="button"
        class="chip"
        :class="{ active: activeMode === mode }"
        @click="emit('update:activeMode', mode)"
      >
        {{ modeChipLabel(mode) }}
      </button>
    </div>
    <p class="hint">Mitä liikkuu juuri nyt</p>
    <div class="list">
      <div v-if="lines.length === 0" class="empty">
        Ei ajoneuvoja juuri nyt tällä suodattimella.
      </div>
      <div v-for="row in lines" :key="row.key" class="row">
        <span class="badge" :style="{ background: modeColor(row.mode) }">{{ row.line }}</span>
        <span class="row-mode">{{ modeLabel(row.mode) }}</span>
        <span class="row-count">{{ row.count }} nyt</span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #121a2c;
  border-right: 1px solid rgba(233, 237, 244, 0.1);
  color: #e9edf4;
  font-family: system-ui, sans-serif;
  overflow: hidden;
}

.sidebar-head {
  padding: 18px 18px 14px;
  font-weight: 800;
  font-size: 17px;
  border-bottom: 1px solid rgba(233, 237, 244, 0.1);
}

.chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding: 14px 16px 4px;
}

.chip {
  font-size: 12px;
  padding: 6px 11px;
  border-radius: 999px;
  border: 1px solid rgba(233, 237, 244, 0.18);
  background: rgba(255, 255, 255, 0.05);
  color: #8c96b3;
  cursor: pointer;
}

.chip.active {
  background: #ff7a45;
  border-color: transparent;
  color: #2a0f04;
  font-weight: 600;
}

.hint {
  margin: 10px 16px 2px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #5b6584;
}

.list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.empty {
  padding: 16px 8px;
  color: #5b6584;
  font-size: 13px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px;
  border-radius: 8px;
}

.badge {
  font-weight: 700;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  color: #0a0f1c;
  min-width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.row-mode {
  flex: 1;
  font-size: 13px;
  color: #8c96b3;
}

.row-count {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #ff7a45;
}
</style>
