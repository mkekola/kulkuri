import { ref } from 'vue';
import { fetchAllRoutes, type RouteSummary } from '../lib/digitransit';

// Module-level like useTrunkRoutes, and riding on the same cached
// fetchAllRoutes() promise the sidebar already triggers - this adds a second
// reader of that one list, not a second request.
const routes = ref<RouteSummary[]>([]);
let requested = false;

// Empty until the fetch resolves (or forever, without an API key). Callers
// have to cope with that rather than wait on it, same as everything else
// Digitransit-backed in this app.
export function useRoutes() {
  if (!requested) {
    requested = true;
    void fetchAllRoutes().then((all) => {
      routes.value = all;
    });
  }
  return routes;
}
