<script setup lang="ts">
import { computed, ref } from 'vue';
import type { VehicleMap } from '../composables/useVehiclePositions';
import { modeColor, modeLabel } from '../lib/vehicleModes';

const props = defineProps<{
  vehicles: VehicleMap;
  activeMode: string;
  selectedRoute: string | null;
}>();
const emit = defineEmits<{
  'update:activeMode': [mode: string];
  'select-line': [route: string | null];
}>();

const MODES = ['all', 'bus', 'tram', 'metro', 'train', 'ferry'];
const searchQuery = ref('');

interface LineRow {
  key: string;
  line: string;
  mode: string;
  route: string | null;
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
      byLine.set(key, { key, line: label, mode, route, count: 1 });
    }
  }
  const query = searchQuery.value.trim().toLowerCase();
  const rows = Array.from(byLine.values()).sort((a, b) => b.count - a.count);
  return query ? rows.filter((row) => row.line.toLowerCase().includes(query)) : rows;
});

function selectLine(row: LineRow) {
  emit('select-line', props.selectedRoute === row.route ? null : row.route);
}

function modeChipLabel(mode: string): string {
  return mode === 'all' ? 'Kaikki' : modeLabel(mode);
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-head">Kulkuri</div>
    <input
      v-model="searchQuery"
      type="search"
      class="search"
      placeholder="Etsi linjaa…"
      aria-label="Etsi linjaa"
    />
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
        {{
          searchQuery.trim()
            ? `Ei linjaa "${searchQuery.trim()}" liikkeellä juuri nyt.`
            : 'Ei ajoneuvoja juuri nyt tällä suodattimella.'
        }}
      </div>
      <button
        v-for="row in lines"
        :key="row.key"
        type="button"
        class="row"
        :class="{ active: selectedRoute === row.route }"
        @click="selectLine(row)"
      >
        <span class="badge" :style="{ background: modeColor(row.mode) }">{{ row.line }}</span>
        <span class="row-mode">{{ modeLabel(row.mode) }}</span>
        <span class="row-count">{{ row.count }} nyt</span>
      </button>
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

.search {
  margin: 14px 16px 0;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid rgba(233, 237, 244, 0.18);
  background: #1a2440;
  color: #e9edf4;
  font-size: 13px;
  font-family: inherit;
}

.search::placeholder {
  color: #5b6584;
}

.search:focus-visible {
  outline: 2px solid #ff7a45;
  outline-offset: 1px;
}

/* Safari/Chrome add a default search-cancel button that clashes with the
   custom styling; the native clear affordance isn't needed at this size. */
.search::-webkit-search-cancel-button {
  display: none;
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
  width: 100%;
  border: none;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
  color: inherit;
}

.row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.row.active {
  background: #1a2440;
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
