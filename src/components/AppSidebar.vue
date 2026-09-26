<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import type { VehicleMap } from '../composables/useVehiclePositions';
import type { FavoriteLine, FavoriteStop } from '../composables/useFavorites';
import type { Theme } from '../composables/useTheme';
import { useNow } from '../composables/useNow';
import { useTrunkRoutes } from '../composables/useTrunkRoutes';
import { MODE_COLORS, badgeColor, modeLabel, normalizeMode } from '../lib/vehicleModes';
import {
  fetchAllRoutes,
  fetchStopDepartures,
  searchStops,
  type Departure,
  type RouteSummary,
  type StopResult,
} from '../lib/digitransit';
import { formatDepartureCountdown } from '../lib/departureTime';
import { UNKNOWN_STOP_MODE } from '../lib/stopIcons';
import StarIcon from './StarIcon.vue';

const props = defineProps<{
  vehicles: VehicleMap;
  activeMode: string;
  selectedRoute: string | null;
  favoriteLines: FavoriteLine[];
  favoriteStops: FavoriteStop[];
  theme: Theme;
}>();
const emit = defineEmits<{
  'update:activeMode': [mode: string];
  'select-line': [route: string | null, mode: string | null];
  'toggle-favorite-line': [line: FavoriteLine];
  'add-favorite-stop': [stop: FavoriteStop];
  'remove-favorite-stop': [gtfsId: string];
  'locate-stop': [stop: FavoriteStop];
  'toggle-theme': [];
}>();

const MODES = ['all', 'bus', 'tram', 'metro', 'train', 'ferry'];
const TABS = [
  { id: 'live', label: 'Nyt liikkeellä' },
  { id: 'omat', label: 'Omat' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const activeTab = ref<TabId>('live');
// Below the mobile breakpoint the sidebar becomes a bottom sheet (see the
// media query below); this only matters there - desktop ignores it. Matches
// the breakpoint the CSS media query below uses - there's no clean way to
// share one number between a <script> condition and a CSS media query, so
// this is the one place in JS that has to know it too.
const MOBILE_BREAKPOINT_PX = 720;
const isMobileLayout = ref(false);
function updateIsMobileLayout() {
  isMobileLayout.value = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches;
}

// Matches --mobile-sheet-collapsed-height in style.css (see that variable's
// own comment for why it's shared with PulseMap.vue too) - the sheet's own
// height while dragging is tracked here in JS instead, so this is the floor
// that clamps it, not just the collapsed CSS default.
const COLLAPSED_HEIGHT_PX = 130;
const EXPANDED_HEIGHT_RATIO = 0.78; // matches the 78vh max-height a tap/swipe snaps open to
function maxSheetHeightPx() {
  return window.innerHeight * EXPANDED_HEIGHT_RATIO;
}

// A real drawer, not just a two-position toggle: dragging the handle tracks
// the finger 1:1 and can be let go at any height in between, clamped to
// [collapsed, max] - not snapped to either end. A tap (no real movement)
// still quick-toggles between fully collapsed and fully open, same as
// tapping the map (or anywhere else outside the sheet) still fully closes
// it, regardless of whatever height it was dragged to.
const sheetHeightPx = ref(COLLAPSED_HEIGHT_PX);
const isDraggingSheet = ref(false);
const isSheetOpen = computed(() => sheetHeightPx.value > COLLAPSED_HEIGHT_PX + 1);
const sidebarEl = useTemplateRef<HTMLElement>('sidebarEl');

let dragStartY = 0;
let dragStartHeight = 0;
let dragMoved = false;
const DRAG_MOVE_THRESHOLD_PX = 4; // below this, treat it as a tap, not a drag

// A drag can start from anywhere on the sheet - not just the handle - but
// two kinds of target opt out: the scrollable lists (they need their own
// native scroll, not to be hijacked into resizing the sheet) and every
// other interactive control (buttons, the search input - a tap on those
// needs to reach them normally, not get eaten as a failed drag attempt).
// The handle itself is the one exception to the "interactive control" rule,
// since dragging *it* specifically is the whole feature.
function isDragBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('.list, .omat')) return true;
  const interactive = target.closest('button, input, a, [role="button"]');
  return interactive != null && !interactive.classList.contains('sheet-handle');
}

function onSheetTouchStart(e: TouchEvent) {
  if (isDragBlocked(e.target)) return;
  const y = e.touches[0]?.clientY;
  if (y == null) return;
  dragStartY = y;
  dragStartHeight = sheetHeightPx.value;
  dragMoved = false;
  isDraggingSheet.value = true;
}

function onSheetTouchMove(e: TouchEvent) {
  if (!isDraggingSheet.value) return;
  const y = e.touches[0]?.clientY;
  if (y == null) return;
  const dy = y - dragStartY;
  if (Math.abs(dy) > DRAG_MOVE_THRESHOLD_PX) dragMoved = true;
  // Dragging up (negative dy) should grow the sheet, hence the flip.
  const next = dragStartHeight - dy;
  sheetHeightPx.value = Math.min(maxSheetHeightPx(), Math.max(COLLAPSED_HEIGHT_PX, next));
}

function onSheetTouchEnd(e: TouchEvent) {
  if (!isDraggingSheet.value) return;
  isDraggingSheet.value = false;
  if (dragMoved) {
    // A real drag - preventDefault() stops the synthetic 'click' a touch
    // interaction fires afterwards, so nothing under the finger (say, a
    // chip the drag happened to end on top of) also "activates".
    e.preventDefault();
    return;
  }
  // Not a real drag, so whatever's under the finger should still get its
  // own normal tap/click - except the handle, which treats a tap as its
  // own "toggle fully open/closed" shortcut (same as before this let
  // dragging start from anywhere else too).
  if ((e.target as Element | null)?.closest('.sheet-handle')) {
    e.preventDefault();
    onHandleClick();
  }
}

// The tap-to-toggle path - shared by a genuine tap on the handle
// (onSheetTouchEnd, once it's ruled out a real drag) and a mouse click, for
// testing/hybrid devices at a mobile viewport width.
function onHandleClick() {
  sheetHeightPx.value = isSheetOpen.value ? COLLAPSED_HEIGHT_PX : maxSheetHeightPx();
}

// Tapping the map (or anywhere else outside the sheet) closes it too, same
// as dragging it back down - a plain click, since that's what a tap
// resolves to afterwards regardless of input type, and MapLibre's own click
// handling on the canvas doesn't stop it from bubbling up here.
function onDocumentClick(e: MouseEvent) {
  if (!isSheetOpen.value) return;
  if (sidebarEl.value && !sidebarEl.value.contains(e.target as Node)) {
    sheetHeightPx.value = COLLAPSED_HEIGHT_PX;
  }
}
onMounted(() => {
  updateIsMobileLayout();
  window.addEventListener('resize', updateIsMobileLayout);
  document.addEventListener('click', onDocumentClick);
});
onUnmounted(() => {
  window.removeEventListener('resize', updateIsMobileLayout);
  document.removeEventListener('click', onDocumentClick);
});

const searchQuery = ref('');
const stopQuery = ref('');
const stopResults = ref<StopResult[]>([]);
const stopSearchPending = ref(false);
const trunkRouteIds = useTrunkRoutes();

// Off by default - the live feed alone can only ever answer "what's moving
// right now", which is this tab's whole point. Fetched lazily (only once
// actually switched on) rather than eagerly on mount, since most visits
// probably never need it.
const showAllLines = ref(false);
const allRoutes = ref<RouteSummary[]>([]);
let allRoutesRequested = false;

function toggleShowAllLines() {
  showAllLines.value = !showAllLines.value;
  if (showAllLines.value && !allRoutesRequested) {
    allRoutesRequested = true;
    void fetchAllRoutes().then((routes) => {
      allRoutes.value = routes;
    });
  }
}

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

  if (showAllLines.value) {
    const liveRoutes = new Set(
      Array.from(byLine.values(), (row) => row.route).filter(
        (route): route is string => route != null,
      ),
    );
    for (const summary of allRoutes.value) {
      if (liveRoutes.has(summary.route)) continue;
      const mode = normalizeMode(summary.mode);
      // Digitransit's route list also includes demand-responsive/call
      // transport ("taxi" mode, named after a neighbourhood rather than a
      // line number) - not a real line a rider would browse for here.
      if (!(mode in MODE_COLORS)) continue;
      if (props.activeMode !== 'all' && mode !== props.activeMode) continue;
      const label = summary.shortName ?? summary.route;
      const key = `${mode}/${label}`;
      if (!byLine.has(key))
        byLine.set(key, { key, line: label, mode, route: summary.route, count: 0 });
    }
  }

  const query = searchQuery.value.trim().toLowerCase();
  const rows = Array.from(byLine.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.line.localeCompare(b.line, 'fi', { numeric: true });
  });
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

const now = useNow(15_000);
// undefined = not fetched yet (renders as "Haetaan…"), null = fetched but
// nothing found, Departure = the soonest one. Map mutations are reactive
// in Vue 3, same as a plain object's.
const nextDepartureByStop = ref(new Map<string, Departure | null>());

function refreshFavoriteStopDepartures() {
  for (const stop of props.favoriteStops) {
    void fetchStopDepartures(stop.gtfsId).then(({ departures }) => {
      nextDepartureByStop.value.set(stop.gtfsId, departures[0] ?? null);
    });
  }
}

let favoriteStopsRefreshTimer: ReturnType<typeof setInterval> | undefined;
// Only fetched/refreshed while "Omat" is actually the visible tab - no
// point polling every favorite stop's departures for a list nobody's
// looking at. Restarts (and re-fetches once immediately) whenever the
// favorites list itself changes too, so a newly starred stop gets its
// departures right away instead of waiting for the next tick.
watch(
  [activeTab, () => props.favoriteStops],
  ([tab, stops]) => {
    clearInterval(favoriteStopsRefreshTimer);
    if (tab !== 'omat' || stops.length === 0) return;
    refreshFavoriteStopDepartures();
    favoriteStopsRefreshTimer = setInterval(refreshFavoriteStopDepartures, 30_000);
  },
  { immediate: true },
);
onUnmounted(() => clearInterval(favoriteStopsRefreshTimer));

interface FavoriteStopRow extends FavoriteStop {
  nextDeparture: Departure | null | undefined;
}

const favoriteStopRows = computed<FavoriteStopRow[]>(() =>
  props.favoriteStops.map((stop) => ({
    ...stop,
    nextDeparture: nextDepartureByStop.value.get(stop.gtfsId),
  })),
);

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

function selectLine(row: { route: string | null; mode: string }) {
  const nextRoute = props.selectedRoute === row.route ? null : row.route;
  emit('select-line', nextRoute, nextRoute ? row.mode : null);
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
    mode: stop.vehicleMode ? normalizeMode(stop.vehicleMode) : UNKNOWN_STOP_MODE,
  });
}

function isFavoriteStop(gtfsId: string): boolean {
  return props.favoriteStops.some((s) => s.gtfsId === gtfsId);
}
</script>

<template>
  <aside
    ref="sidebarEl"
    class="sidebar"
    :class="{ expanded: isSheetOpen, dragging: isDraggingSheet }"
    :style="isMobileLayout ? { maxHeight: `${sheetHeightPx}px` } : undefined"
    @touchstart="onSheetTouchStart"
    @touchmove="onSheetTouchMove"
    @touchend="onSheetTouchEnd"
  >
    <button
      type="button"
      class="sheet-handle"
      :aria-expanded="isSheetOpen"
      aria-label="Näytä tai piilota lisää"
      @click="onHandleClick"
    >
      <span class="handle-bar" aria-hidden="true"></span>
    </button>
    <div class="sidebar-head">
      <div class="sidebar-head-title">
        <img class="logo" src="/favicon.svg" alt="" width="24" height="24" />
        Kulkuri
      </div>
      <button
        type="button"
        class="theme-toggle"
        :aria-label="theme === 'dark' ? 'Vaihda vaaleaan teemaan' : 'Vaihda tummaan teemaan'"
        @click="emit('toggle-theme')"
      >
        <svg
          v-if="theme === 'dark'"
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          class="theme-toggle-icon"
        >
          <path
            d="M19.9001 2.30719C19.7392 1.8976 19.1616 1.8976 19.0007 2.30719L18.5703 3.40247C18.5212 3.52752 18.4226 3.62651 18.298 3.67583L17.2067 4.1078C16.7986 4.26934 16.7986 4.849 17.2067 5.01054L18.298 5.44252C18.4226 5.49184 18.5212 5.59082 18.5703 5.71587L19.0007 6.81115C19.1616 7.22074 19.7392 7.22074 19.9001 6.81116L20.3305 5.71587C20.3796 5.59082 20.4782 5.49184 20.6028 5.44252L21.6941 5.01054C22.1022 4.849 22.1022 4.26934 21.6941 4.1078L20.6028 3.67583C20.4782 3.62651 20.3796 3.52752 20.3305 3.40247L19.9001 2.30719Z"
            fill="currentColor"
          />
          <path
            d="M16.0328 8.12967C15.8718 7.72009 15.2943 7.72009 15.1333 8.12967L14.9764 8.52902C14.9273 8.65407 14.8287 8.75305 14.7041 8.80237L14.3062 8.95987C13.8981 9.12141 13.8981 9.70107 14.3062 9.86261L14.7041 10.0201C14.8287 10.0694 14.9273 10.1684 14.9764 10.2935L15.1333 10.6928C15.2943 11.1024 15.8718 11.1024 16.0328 10.6928L16.1897 10.2935C16.2388 10.1684 16.3374 10.0694 16.462 10.0201L16.8599 9.86261C17.268 9.70107 17.268 9.12141 16.8599 8.95987L16.462 8.80237C16.3374 8.75305 16.2388 8.65407 16.1897 8.52902L16.0328 8.12967Z"
            fill="currentColor"
          />
          <path
            d="M12 22C17.5228 22 22 17.5228 22 12C22 11.5373 21.3065 11.4608 21.0672 11.8568C19.9289 13.7406 17.8615 15 15.5 15C11.9101 15 9 12.0899 9 8.5C9 6.13845 10.2594 4.07105 12.1432 2.93276C12.5392 2.69347 12.4627 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"
            fill="currentColor"
          />
        </svg>
        <svg v-else aria-hidden="true" viewBox="0 0 24 24" fill="none" class="theme-toggle-icon">
          <path
            d="M18 12C18 15.3137 15.3137 18 12 18C8.68629 18 6 15.3137 6 12C6 8.68629 8.68629 6 12 6C15.3137 6 18 8.68629 18 12Z"
            fill="currentColor"
          />
          <path
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M12 1.25C12.4142 1.25 12.75 1.58579 12.75 2V3C12.75 3.41421 12.4142 3.75 12 3.75C11.5858 3.75 11.25 3.41421 11.25 3V2C11.25 1.58579 11.5858 1.25 12 1.25ZM4.39861 4.39861C4.6915 4.10572 5.16638 4.10572 5.45927 4.39861L5.85211 4.79145C6.145 5.08434 6.145 5.55921 5.85211 5.85211C5.55921 6.145 5.08434 6.145 4.79145 5.85211L4.39861 5.45927C4.10572 5.16638 4.10572 4.6915 4.39861 4.39861ZM19.6011 4.39887C19.894 4.69176 19.894 5.16664 19.6011 5.45953L19.2083 5.85237C18.9154 6.14526 18.4405 6.14526 18.1476 5.85237C17.8547 5.55947 17.8547 5.0846 18.1476 4.79171L18.5405 4.39887C18.8334 4.10598 19.3082 4.10598 19.6011 4.39887ZM1.25 12C1.25 11.5858 1.58579 11.25 2 11.25H3C3.41421 11.25 3.75 11.5858 3.75 12C3.75 12.4142 3.41421 12.75 3 12.75H2C1.58579 12.75 1.25 12.4142 1.25 12ZM20.25 12C20.25 11.5858 20.5858 11.25 21 11.25H22C22.4142 11.25 22.75 11.5858 22.75 12C22.75 12.4142 22.4142 12.75 22 12.75H21C20.5858 12.75 20.25 12.4142 20.25 12ZM18.1476 18.1476C18.4405 17.8547 18.9154 17.8547 19.2083 18.1476L19.6011 18.5405C19.894 18.8334 19.894 19.3082 19.6011 19.6011C19.3082 19.894 18.8334 19.894 18.5405 19.6011L18.1476 19.2083C17.8547 18.9154 17.8547 18.4405 18.1476 18.1476ZM5.85211 18.1479C6.145 18.4408 6.145 18.9157 5.85211 19.2086L5.45927 19.6014C5.16638 19.8943 4.6915 19.8943 4.39861 19.6014C4.10572 19.3085 4.10572 18.8336 4.39861 18.5407L4.79145 18.1479C5.08434 17.855 5.55921 17.855 5.85211 18.1479ZM12 20.25C12.4142 20.25 12.75 20.5858 12.75 21V22C12.75 22.4142 12.4142 22.75 12 22.75C11.5858 22.75 11.25 22.4142 11.25 22V21C11.25 20.5858 11.5858 20.25 12 20.25Z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
    <div class="tabs">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        type="button"
        class="tab"
        :class="{ active: activeTab === tab.id }"
        @click="
          activeTab = tab.id;
          sheetHeightPx = maxSheetHeightPx();
        "
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
      <div class="hint-row">
        <p class="hint">Mitä liikkuu juuri nyt</p>
        <button type="button" class="show-all-toggle" @click="toggleShowAllLines">
          {{ showAllLines ? 'Piilota tyhjät' : 'Näytä kaikki linjat' }}
        </button>
      </div>
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
            <span
              class="badge"
              :style="{
                background: badgeColor(row.mode, row.route != null && trunkRouteIds.has(row.route)),
              }"
              >{{ row.line }}</span
            >
            <span class="row-mode">{{ modeLabel(row.mode) }}</span>
            <span class="row-count" :class="{ muted: row.count === 0 }">
              {{ row.count > 0 ? `${row.count} nyt` : 'ei nyt liikkeellä' }}
            </span>
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
            <StarIcon class="star-icon" />
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
              <span
                class="badge"
                :style="{ background: badgeColor(row.mode, trunkRouteIds.has(row.route)) }"
                >{{ row.line }}</span
              >
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
              <StarIcon class="star-icon" />
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

          <div v-if="favoriteStopRows.length === 0" class="empty">Ei vielä suosikkipysäkkejä.</div>
          <div v-else class="stop-cards">
            <div v-for="stop in favoriteStopRows" :key="stop.gtfsId" class="stop-card">
              <button type="button" class="stop-card-main" @click="emit('locate-stop', stop)">
                <div class="stop-card-head">
                  <span class="stop-name">{{ stop.name }}</span>
                  <span class="stop-code">{{ stop.code ?? stop.gtfsId }}</span>
                </div>
                <div class="stop-card-next">
                  <span v-if="stop.nextDeparture === undefined" class="stop-card-next-state">
                    Haetaan…
                  </span>
                  <span v-else-if="stop.nextDeparture === null" class="stop-card-next-state">
                    Ei tiedossa lähtöjä
                  </span>
                  <template v-else>
                    <span
                      class="badge"
                      :style="{
                        background: badgeColor(
                          normalizeMode(stop.nextDeparture.mode),
                          trunkRouteIds.has(stop.nextDeparture.routeId),
                        ),
                      }"
                      >{{ stop.nextDeparture.route }}</span
                    >
                    <span class="stop-card-headsign">{{ stop.nextDeparture.headsign }}</span>
                    <span class="stop-card-eta">
                      <span
                        v-if="stop.nextDeparture.realtime"
                        class="live-dot"
                        aria-hidden="true"
                      ></span>
                      {{ formatDepartureCountdown(stop.nextDeparture.departureAt, now) }}
                    </span>
                  </template>
                </div>
              </button>
              <button
                type="button"
                class="star active"
                aria-label="Poista suosikeista"
                @click="emit('remove-favorite-stop', stop.gtfsId)"
              >
                <StarIcon class="star-icon" />
              </button>
            </div>
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
  background: var(--surface);
  border-right: 1px solid var(--line);
  color: var(--text);
  font-family: var(--font-body);
  overflow: hidden;
}

.sidebar-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 14px 14px 18px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}

.sidebar-head-title {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 17px;
}

.sheet-handle {
  display: none;
}

.logo {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 6px;
}

.theme-toggle {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: none;
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.theme-toggle:hover {
  background: var(--hover-fill);
}

.theme-toggle-icon {
  width: 17px;
  height: 17px;
}

.handle-bar {
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
    max-height: var(--mobile-sheet-collapsed-height);
    border-right: none;
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.45);
    z-index: 20;
    transition: max-height 0.25s ease;
    /* A drag can start anywhere on the sheet now, not just the handle - the
       browser's own touch-scroll/bounce handling would otherwise fight the
       1:1 tracking those touchmove handlers do. .list/.omat below opt back
       into their own native scroll, since they're excluded from starting a
       drag in the first place (see isDragBlocked()). */
    touch-action: none;
  }

  .sidebar.expanded {
    max-height: 78vh;
  }

  /* While actively dragging, the inline max-height above needs to track the
     finger 1:1 - the transition otherwise makes it visibly lag behind. */
  .sidebar.dragging {
    transition: none;
  }

  /* Opts back into native vertical scrolling against the sheet's own
     touch-action: none above - isDragBlocked() already keeps a touch
     starting in here from being read as a resize attempt in the first
     place, so this is what actually makes the scroll itself work. */
  .list,
  .omat {
    touch-action: pan-y;
  }

  .sheet-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 26px;
    flex-shrink: 0;
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
  }

  /* A plain grip line instead of a directional arrow - the classic
     drag-handle/"pull tab" look, and unlike a chevron it doesn't need to
     flip between open/closed since dragging (not just reading) it is the
     whole affordance. */
  .handle-bar {
    display: block;
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--line-strong);
  }

  .sheet-handle:active .handle-bar {
    background: var(--muted);
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
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}

.tab.active {
  color: var(--text);
  border-bottom-color: var(--accent-text);
}

.search {
  margin: 14px 16px 0;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
  width: calc(100% - 32px);
}

.search--inline {
  margin: 0 0 8px;
  width: 100%;
}

.search::placeholder {
  color: var(--faint);
}

.search:focus-visible {
  outline: 2px solid var(--accent-text);
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
  border: 1px solid var(--line-strong);
  background: var(--hover-fill);
  color: var(--muted);
  cursor: pointer;
}

.chip.active {
  background: var(--accent);
  border-color: transparent;
  color: var(--on-fill);
  font-weight: 600;
}

.hint {
  margin: 10px 16px 2px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--faint);
}

.hint-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding-right: 12px;
}

.hint-row .hint {
  margin-right: 0;
}

.show-all-toggle {
  flex-shrink: 0;
  border: none;
  background: none;
  padding: 4px 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent-text);
  cursor: pointer;
}

.show-all-toggle:hover,
.show-all-toggle:focus-visible {
  text-decoration: underline;
}

.list,
.omat {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  /* Firefox: thumb color, then track color. */
  scrollbar-width: thin;
  scrollbar-color: var(--muted) var(--surface);
}

.list {
  padding: 8px 10px 16px;
  gap: 2px;
}

.omat {
  padding: 12px 10px 16px;
  gap: 20px;
}

/* WebKit/Blink (Chrome, Safari, Edge). Arrow-glyph coloring itself isn't
   scriptable - browsers draw that natively - but track/thumb match the
   sidebar so the scrollbar reads as part of it instead of a bolted-on
   system control. */
.list::-webkit-scrollbar,
.omat::-webkit-scrollbar {
  width: 10px;
}

.list::-webkit-scrollbar-track,
.omat::-webkit-scrollbar-track {
  background: var(--surface);
}

.list::-webkit-scrollbar-thumb,
.omat::-webkit-scrollbar-thumb {
  background: var(--muted);
  border-radius: 999px;
  border: 2px solid var(--surface);
}

.list::-webkit-scrollbar-button,
.omat::-webkit-scrollbar-button {
  background: var(--surface);
}

.omat-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.empty {
  padding: 10px 8px;
  color: var(--faint);
  font-size: 13px;
}

.row {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 8px;
}

.row:hover {
  background: var(--hover-fill);
}

.row.active {
  background: var(--surface-2);
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
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: none;
  background: none;
  color: var(--subtle);
  cursor: pointer;
  margin-right: 4px;
}

.star-icon {
  width: 16px;
  height: 16px;
}

.star:hover {
  color: var(--faint);
}

.star.active {
  color: var(--accent-text);
}

.star:disabled {
  opacity: 0.3;
  cursor: default;
}

.badge {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  color: var(--on-fill);
  min-width: 20px;
  max-width: 120px;
  text-align: center;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-mode {
  flex: 1;
  font-size: 13px;
  color: var(--muted);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-count {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--accent-text);
  flex-shrink: 0;
}

.row-count.muted {
  color: var(--faint);
}

.stop-results {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface-2);
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
  background: var(--hover-fill);
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
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--faint);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.stop-add {
  color: var(--accent-text);
  font-weight: 700;
  flex-shrink: 0;
  width: 14px;
  text-align: center;
}

.stop-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stop-card {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: 12px;
  overflow: hidden;
  background: var(--surface-2);
  border: 1px solid var(--line);
}

.stop-card-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 4px 10px 12px;
  border: none;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
  color: inherit;
  min-width: 0;
}

.stop-card-main:hover {
  background: var(--hover-fill);
}

.stop-card-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.stop-card-next {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.stop-card-next-state {
  font-size: 12px;
  color: var(--faint);
}

.stop-card-headsign {
  flex: 1;
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stop-card-eta {
  font-family: var(--font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--accent-text);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-text);
  flex-shrink: 0;
}
</style>
