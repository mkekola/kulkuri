<script setup lang="ts">
import type { Departure, StopResult } from '../lib/digitransit';
import { badgeColor, normalizeMode } from '../lib/vehicleModes';
import type { AnchoredPosition } from '../lib/anchoredPopup';
import { useNow } from '../composables/useNow';
import { useTrunkRoutes } from '../composables/useTrunkRoutes';
import { formatDepartureCountdown } from '../lib/departureTime';
import StarIcon from './StarIcon.vue';

defineProps<{
  stop: StopResult;
  departures: Departure[] | null;
  position: AnchoredPosition;
  isFavorite: boolean;
}>();
defineEmits<{ close: []; 'toggle-favorite': [] }>();

const now = useNow(15_000);
const trunkRouteIds = useTrunkRoutes();
</script>

<template>
  <div
    class="stop-detail-anchor"
    :class="position.placement"
    :style="{ left: `${position.left}px`, top: `${position.top}px`, width: `${position.width}px` }"
  >
    <!-- The tail pokes out past the card's own edge, so it has to live
         outside stop-detail's overflow:hidden (needed to clip the
         scrollable departures list to its rounded corners) rather than
         inside it. -->
    <div class="tail" :style="{ left: `${position.tailOffset}px` }" aria-hidden="true"></div>
    <div class="stop-detail">
      <div class="head">
        <div class="title">
          <span class="name">{{ stop.name }}</span>
          <span v-if="stop.code" class="code">{{ stop.code }}</span>
        </div>
        <button
          type="button"
          class="star"
          :class="{ active: isFavorite }"
          :aria-label="isFavorite ? 'Poista suosikeista' : 'Lisää suosikiksi'"
          @click="$emit('toggle-favorite')"
        >
          <StarIcon class="star-icon" />
        </button>
        <button class="close" type="button" aria-label="Sulje" @click="$emit('close')">×</button>
      </div>

      <div v-if="departures === null" class="state">Haetaan lähtöjä…</div>
      <div v-else-if="departures.length === 0" class="state">Ei tiedossa olevia lähtöjä.</div>
      <div v-else class="departures">
        <div v-for="(d, i) in departures" :key="i" class="departure">
          <span
            class="badge"
            :style="{ background: badgeColor(normalizeMode(d.mode), trunkRouteIds.has(d.routeId)) }"
            >{{ d.route }}</span
          >
          <span class="headsign">{{ d.headsign }}</span>
          <span class="eta">
            <span v-if="d.realtime" class="live-dot" aria-hidden="true"></span>
            {{ formatDepartureCountdown(d.departureAt, now) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Anchored next to the clicked stop on the map (left/top/width are set
   inline from anchoredPositionAt() in PulseMap.vue) instead of stretching
   across the whole map like the old bottom bar. .above sits above the
   marker (shifted up by its own height via transform, since that height
   isn't known ahead of render) and .below sits under it when there's not
   enough room above. */
.stop-detail-anchor {
  position: absolute;
  z-index: 10;
}

.stop-detail-anchor.above {
  transform: translateY(-100%);
}

.stop-detail {
  max-height: min(50vh, 360px);
  display: flex;
  flex-direction: column;
  background: var(--surface-translucent);
  backdrop-filter: blur(6px);
  border: 1px solid var(--line-strong);
  border-radius: 14px;
  color: var(--text);
  font-family: var(--font-body);
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
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

.stop-detail-anchor.above .tail {
  bottom: -8px;
  border-right: 1px solid var(--line-strong);
  border-bottom: 1px solid var(--line-strong);
}

.stop-detail-anchor.below .tail {
  top: -8px;
  border-left: 1px solid var(--line-strong);
  border-top: 1px solid var(--line-strong);
}

.head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 8px 12px 16px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}

.title {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.name {
  font-weight: 700;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.code {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.star {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--subtle);
  cursor: pointer;
  padding: 4px 6px;
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

.close {
  background: none;
  border: none;
  color: var(--muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  padding: 4px 8px;
  flex-shrink: 0;
}

.close:hover,
.close:focus-visible {
  color: var(--text);
}

.state {
  padding: 16px;
  color: var(--muted);
  font-size: 13px;
}

.departures {
  overflow-y: auto;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.departure {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px;
}

.badge {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  color: var(--on-fill);
  min-width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.headsign {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.eta {
  font-family: var(--font-mono);
  font-size: 13px;
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
}
</style>
