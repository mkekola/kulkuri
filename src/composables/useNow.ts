import { onMounted, onUnmounted, ref } from 'vue';

// A ref that re-reads Date.now() on an interval, so any relative-time text
// derived from it (a departure countdown, "x min ago") stays fresh without
// each caller needing its own ticker.
export function useNow(intervalMs: number) {
  const now = ref(Date.now());
  let ticker: ReturnType<typeof setInterval> | undefined;
  onMounted(() => {
    ticker = setInterval(() => {
      now.value = Date.now();
    }, intervalMs);
  });
  onUnmounted(() => clearInterval(ticker));
  return now;
}
