import { ref } from 'vue';
import { fetchTrunkRouteIds } from '../lib/digitransit';

// Module-level, not per-call: every caller shares the one fetch/cache
// (fetchTrunkRouteIds() itself rides on fetchAllRoutes()'s own cached
// promise) and the same reactive result, so the badge in the sidebar and
// the one in a map popup update from the same data the instant it arrives.
const trunkRouteIds = ref<Set<string>>(new Set());
let requested = false;

// Empty until the fetch resolves (or forever, without an API key) - callers
// just get no trunk highlighting until then, same as every other
// Digitransit-backed feature in this app.
export function useTrunkRoutes() {
  if (!requested) {
    requested = true;
    void fetchTrunkRouteIds().then((ids) => {
      trunkRouteIds.value = ids;
    });
  }
  return trunkRouteIds;
}
