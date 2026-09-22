<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { VehicleMap } from '../composables/useVehiclePositions';
import type { FavoriteLine, FavoriteStop } from '../composables/useFavorites';
import { modeColor, modeLabel, normalizeMode } from '../lib/vehicleModes';
import { searchStops, type StopResult } from '../lib/digitransit';

const props = defineProps<{
  vehicles: VehicleMap;
  activeMode: string;
  selectedRoute: string | null;
  favoriteLines: FavoriteLine[];
  favoriteStops: FavoriteStop[];
}>();
const emit = defineEmits<{
  'update:activeMode': [mode: string];
  'select-line': [route: string | null];
  'toggle-favorite-line': [line: FavoriteLine];
  'add-favorite-stop': [stop: FavoriteStop];
  'remove-favorite-stop': [gtfsId: string];
  'locate-stop': [stop: FavoriteStop];
}>();

const MODES = ['all', 'bus', 'tram', 'metro', 'train', 'ferry'];
const TABS = [
  { id: 'live', label: 'Nyt liikkeellä' },
  { id: 'omat', label: 'Omat' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const activeTab = ref<TabId>('live');
// Below the mobile breakpoint the sidebar becomes a bottom sheet (see the
// media query below); this only matters there - desktop ignores it.
const mobileExpanded = ref(false);
const searchQuery = ref('');
const stopQuery = ref('');
const stopResults = ref<StopResult[]>([]);
const stopSearchPending = ref(false);

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

const favoriteLineRows = computed(() => {
  const liveCounts = new Map<string, number>();
  for (const feature of props.vehicles.values()) {
    const { route } = feature.properties;
    if (!route) continue;
    liveCounts.set(route, (liveCounts.get(route) ?? 0) + 1);
  }
  return props.favoriteLines.map((f) => ({ ...f, count: liveCounts.get(f.route) ?? 0 }));
});

let stopSearchTimer: ReturnType<typeof setTimeout> | undefined;
watch(stopQuery, (query) => {
  clearTimeout(stopSearchTimer);
  if (query.trim().length < 2) {
    stopResults.value = [];
    stopSearchPending.value = false;
    return;
  }
  stopSearchPending.value = true;
  stopSearchTimer = setTimeout(() => {
    void searchStops(query).then((results) => {
      // Ignore a stale response if the query moved on while it was in flight.
      if (stopQuery.value === query) {
        stopResults.value = results;
        stopSearchPending.value = false;
      }
    });
  }, 300);
});

function selectLine(row: { route: string | null }) {
  emit('select-line', props.selectedRoute === row.route ? null : row.route);
}

function modeChipLabel(mode: string): string {
  return mode === 'all' ? 'Kaikki' : modeLabel(mode);
}

function isFavoriteRoute(route: string | null): boolean {
  return route != null && props.favoriteLines.some((f) => f.route === route);
}

function addStop(stop: StopResult) {
  emit('add-favorite-stop', {
    gtfsId: stop.gtfsId,
    name: stop.name,
    code: stop.code,
    lat: stop.lat,
    lon: stop.lon,
    mode: normalizeMode(stop.vehicleMode ?? ''),
  });
}

function isFavoriteStop(gtfsId: string): boolean {
  return props.favoriteStops.some((s) => s.gtfsId === gtfsId);
}
</script>

<template>
  <aside class="sidebar" :class="{ expanded: mobileExpanded }">
    <button
      type="button"
      class="sidebar-head"
      :aria-expanded="mobileExpanded"
      @click="mobileExpanded = !mobileExpanded"
    >
      Kulkuri
      <span class="chevron" aria-hidden="true"></span>
    </button>
    <div class="tabs">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        type="button"
        class="tab"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <template v-if="activeTab === 'live'">
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
        <div
          v-for="row in lines"
          :key="row.key"
          class="row"
          :class="{ active: selectedRoute === row.route }"
        >
          <button type="button" class="row-main" @click="selectLine(row)">
            <span class="badge" :style="{ background: modeColor(row.mode) }">{{ row.line }}</span>
            <span class="row-mode">{{ modeLabel(row.mode) }}</span>
            <span class="row-count">{{ row.count }} nyt</span>
          </button>
          <button
            type="button"
            class="star"
            :class="{ active: isFavoriteRoute(row.route) }"
            :aria-label="isFavoriteRoute(row.route) ? 'Poista suosikeista' : 'Lisää suosikiksi'"
            :disabled="!row.route"
            @click="
              row.route &&
              emit('toggle-favorite-line', { route: row.route, mode: row.mode, line: row.line })
            "
          >
            ★
          </button>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="omat">
        <div class="omat-section">
          <p class="hint">Suosikkilinjat</p>
          <div v-if="favoriteLineRows.length === 0" class="empty">
            Ei vielä suosikkilinjoja — tähditä linja Nyt liikkeellä -välilehdeltä.
          </div>
          <div
            v-for="row in favoriteLineRows"
            :key="row.route"
            class="row"
            :class="{ active: selectedRoute === row.route }"
          >
            <button type="button" class="row-main" @click="selectLine(row)">
              <span class="badge" :style="{ background: modeColor(row.mode) }">{{ row.line }}</span>
              <span class="row-mode">{{ modeLabel(row.mode) }}</span>
              <span class="row-count" :class="{ muted: row.count === 0 }">
                {{ row.count > 0 ? `${row.count} nyt` : 'ei nyt liikkeellä' }}
              </span>
            </button>
            <button
              type="button"
              class="star active"
              aria-label="Poista suosikeista"
              @click="emit('toggle-favorite-line', row)"
            >
              ★
            </button>
          </div>
        </div>

        <div class="omat-section">
          <p class="hint">Suosikkipysäkit</p>
          <input
            v-model="stopQuery"
            type="search"
            class="search search--inline"
            placeholder="Hae pysäkkiä…"
            aria-label="Hae pysäkkiä"
          />
          <div v-if="stopQuery.trim().length >= 2" class="stop-results">
            <div v-if="stopSearchPending" class="empty">Haetaan…</div>
            <div v-else-if="stopResults.length === 0" class="empty">Ei tuloksia.</div>
            <button
              v-for="stop in stopResults"
              :key="stop.gtfsId"
              type="button"
              class="stop-result"
              :disabled="isFavoriteStop(stop.gtfsId)"
              @click="addStop(stop)"
            >
              <span class="stop-name">{{ stop.name }}</span>
              <span class="stop-code">{{ stop.code ?? stop.gtfsId }}</span>
              <span class="stop-add">{{ isFavoriteStop(stop.gtfsId) ? '✓' : '+' }}</span>
            </button>
          </div>

          <div v-if="favoriteStops.length === 0" class="empty">Ei vielä suosikkipysäkkejä.</div>
          <div v-for="stop in favoriteStops" :key="stop.gtfsId" class="row">
            <button type="button" class="row-main" @click="emit('locate-stop', stop)">
              <span class="stop-name">{{ stop.name }}</span>
              <span class="stop-code">{{ stop.code ?? stop.gtfsId }}</span>
            </button>
            <button
              type="button"
              class="star active"
              aria-label="Poista suosikeista"
              @click="emit('remove-favorite-stop', stop.gtfsId)"
            >
              ★
            </button>
          </div>
        </div>
      </div>
    </template>
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 18px 18px 14px;
  font: inherit;
  font-weight: 800;
  font-size: 17px;
  color: inherit;
  border: none;
  border-bottom: 1px solid rgba(233, 237, 244, 0.1);
  background: none;
  width: 100%;
  text-align: left;
  cursor: default;
  flex-shrink: 0;
}

.chevron {
  display: none;
}

/* Below this width the sidebar becomes a bottom sheet over the map instead
   of a fixed column - same movement language as the vehicle/stop cards. */
@media (max-width: 720px) {
  .sidebar {
    position: fixed;
    inset: auto 0 0 0;
    width: auto;
    height: auto;
    max-height: 100px;
    border-right: none;
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.45);
    z-index: 20;
    transition: max-height 0.25s ease;
  }

  .sidebar.expanded {
    max-height: 78vh;
  }

  .sidebar-head {
    cursor: pointer;
  }

  .chevron {
    display: block;
    width: 10px;
    height: 10px;
    border-right: 2px solid #8c96b3;
    border-bottom: 2px solid #8c96b3;
    transform: rotate(-45deg);
    transition: transform 0.2s ease;
    flex-shrink: 0;
  }

  .sidebar.expanded .chevron {
    transform: rotate(135deg);
  }
}

.tabs {
  display: flex;
  gap: 2px;
  padding: 10px 12px 0;
}

.tab {
  flex: 1;
  padding: 8px 10px;
  border-radius: 8px 8px 0 0;
  border: none;
  background: none;
  color: #8c96b3;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}

.tab.active {
  color: #e9edf4;
  border-bottom-color: #ff7a45;
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
  width: calc(100% - 32px);
}

.search--inline {
  margin: 0 0 8px;
  width: 100%;
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

.omat {
  flex: 1;
  overflow-y: auto;
  padding: 12px 10px 16px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.omat-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.empty {
  padding: 10px 8px;
  color: #5b6584;
  font-size: 13px;
}

.row {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 8px;
}

.row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.row.active {
  background: #1a2440;
}

.row-main {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 4px 8px 8px;
  border: none;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
  color: inherit;
  min-width: 0;
}

.star {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: none;
  background: none;
  color: #3a4360;
  font-size: 15px;
  cursor: pointer;
  margin-right: 4px;
}

.star:hover {
  color: #5b6584;
}

.star.active {
  color: #ff7a45;
}

.star:disabled {
  opacity: 0.3;
  cursor: default;
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
  min-width: 0;
}

.row-count {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #ff7a45;
  flex-shrink: 0;
}

.row-count.muted {
  color: #5b6584;
}

.stop-results {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
  border-radius: 8px;
  overflow: hidden;
  background: #1a2440;
}

.stop-result {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: none;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
  color: inherit;
}

.stop-result:hover {
  background: rgba(255, 255, 255, 0.05);
}

.stop-result:disabled {
  cursor: default;
  opacity: 0.6;
}

.stop-name {
  flex: 1;
  font-size: 13px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stop-code {
  font-size: 11px;
  color: #5b6584;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.stop-add {
  color: #ff7a45;
  font-weight: 700;
  flex-shrink: 0;
  width: 14px;
  text-align: center;
}
</style>
