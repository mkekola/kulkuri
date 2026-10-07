import { computed, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { formatUrlState, parseUrlState, type UrlState } from '../lib/urlState';

function currentUrl(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/**
 * Keeps the address bar and the app's selection in step, in both directions:
 * picking a line rewrites the URL, and the back button puts the previous
 * selection back.
 *
 * The thing to get right is that the two directions feed each other. Writing
 * the URL from state, then reading state back from the URL, is a loop looking
 * for somewhere to stop, and it stops here in two places.
 */
export function useUrlState(current: () => UrlState, apply: (state: UrlState) => void) {
  const query = computed(() => formatUrlState(current()));

  // Guard one: true while the URL is driving the state. Vue flushes watchers
  // on a microtask, so this cannot be cleared on the next line - the watcher
  // below has not run yet at that point. It is cleared after nextTick, once
  // that watcher has had its chance to see it and stand down.
  let applyingFromUrl = false;

  async function applyFromUrl() {
    applyingFromUrl = true;
    apply(parseUrlState(window.location.search));
    await nextTick();
    applyingFromUrl = false;
  }

  watch(query, (next) => {
    if (applyingFromUrl) return;
    const url = `${window.location.pathname}${next}`;
    // Guard two: writing the URL the browser already shows would stack a
    // history entry identical to the one beneath it, and the back button
    // would then need two presses to do anything visible. This also covers
    // whatever the first guard misses, since a state change that produces the
    // URL we are already on has nothing to record either way.
    if (url === currentUrl()) return;
    window.history.pushState(null, '', url);
  });

  function onPopState() {
    void applyFromUrl();
  }

  onMounted(() => {
    // A link someone shared opens here: the URL wins over the app's defaults.
    void applyFromUrl();
    window.addEventListener('popstate', onPopState);
  });

  onUnmounted(() => {
    window.removeEventListener('popstate', onPopState);
  });

  // Brings the address bar back in line with what the app actually ended up
  // showing, without adding a history entry. For when a link asked for
  // something that could not be honored - a line that no longer runs, say - so
  // the URL stops advertising a selection that is not there. Deliberately the
  // caller's to make: only the caller knows when it has finished trying.
  function replaceUrl() {
    const url = `${window.location.pathname}${query.value}`;
    if (url === currentUrl()) return;
    window.history.replaceState(null, '', url);
  }

  return { replaceUrl };
}
