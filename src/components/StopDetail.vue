<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { Departure, StopResult } from '../lib/digitransit';
import { modeColor, normalizeMode } from '../lib/vehicleModes';

defineProps<{ stop: StopResult; departures: Departure[] | null }>();
defineEmits<{ close: [] }>();

const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  ticker = setInterval(() => {
    now.value = Date.now();
  }, 15_000);
});
onUnmounted(() => clearInterval(ticker));

// en-GB with hour12 off reliably gives "23:45" - locale-formatted time
// strings can otherwise use a period instead of a colon.
const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Europe/Helsinki',
});

function minutesUntil(departureAt: number): string {
  const minutes = Math.round((departureAt - now.value) / 60_000);
  if (minutes <= 0) return 'nyt';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 180) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder > 0 ? `${hours} h ${remainder} min` : `${hours} h`;
  }
  return clockFormatter.format(departureAt);
}
</script>

<template>
  <div class="stop-detail">
    <div class="head">
      <div class="title">
        <span class="name">{{ stop.name }}</span>
        <span v-if="stop.code" class="code">{{ stop.code }}</span>
      </div>
      <button class="close" type="button" aria-label="Sulje" @click="$emit('close')">×</button>
    </div>

    <div v-if="departures === null" class="state">Haetaan lähtöjä…</div>
    <div v-else-if="departures.length === 0" class="state">Ei tiedossa olevia lähtöjä.</div>
    <div v-else class="departures">
      <div v-for="(d, i) in departures" :key="i" class="departure">
        <span class="badge" :style="{ background: modeColor(normalizeMode(d.mode)) }">{{
          d.route
        }}</span>
        <span class="headsign">{{ d.headsign }}</span>
        <span class="eta">
          <span v-if="d.realtime" class="live-dot" aria-hidden="true"></span>
          {{ minutesUntil(d.departureAt) }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stop-detail {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 16px;
  z-index: 10;
  max-height: min(60%, 420px);
  display: flex;
  flex-direction: column;
  background: rgba(18, 26, 44, 0.92);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(233, 237, 244, 0.12);
  border-radius: 16px;
  color: #e9edf4;
  font-family: system-ui, sans-serif;
  overflow: hidden;
}

/* Clears the collapsed mobile sidebar bar (AppSidebar.vue) sitting at the
   very bottom below this breakpoint. */
@media (max-width: 720px) {
  .stop-detail {
    bottom: 116px;
  }
}

.head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 8px 12px 16px;
  border-bottom: 1px solid rgba(233, 237, 244, 0.1);
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
  font-size: 12px;
  color: #8c96b3;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.close {
  background: none;
  border: none;
  color: #8c96b3;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  padding: 4px 8px;
  flex-shrink: 0;
}

.close:hover,
.close:focus-visible {
  color: #e9edf4;
}

.state {
  padding: 16px;
  color: #8c96b3;
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
  font-weight: 700;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  color: #0a0f1c;
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
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: #ff7a45;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ff7a45;
}
</style>
