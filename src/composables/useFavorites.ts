import { ref, watch } from 'vue';

export interface FavoriteLine {
  route: string;
  mode: string;
  line: string;
}

export interface FavoriteStop {
  gtfsId: string;
  name: string;
  code: string | null;
  lat: number;
  lon: number;
  mode: string;
}

const LINES_KEY = 'kulkuri:favoriteLines';
const STOPS_KEY = 'kulkuri:favoriteStops';

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, quota) - favorites just won't persist.
  }
}

export function useFavorites() {
  const favoriteLines = ref<FavoriteLine[]>(loadFromStorage(LINES_KEY, []));
  const favoriteStops = ref<FavoriteStop[]>(loadFromStorage(STOPS_KEY, []));

  watch(favoriteLines, (lines) => saveToStorage(LINES_KEY, lines));
  watch(favoriteStops, (stops) => saveToStorage(STOPS_KEY, stops));

  function toggleFavoriteLine(entry: FavoriteLine) {
    const exists = favoriteLines.value.some((f) => f.route === entry.route);
    favoriteLines.value = exists
      ? favoriteLines.value.filter((f) => f.route !== entry.route)
      : [...favoriteLines.value, entry];
  }

  function addFavoriteStop(stop: FavoriteStop) {
    if (favoriteStops.value.some((s) => s.gtfsId === stop.gtfsId)) return;
    favoriteStops.value = [...favoriteStops.value, stop];
  }

  function removeFavoriteStop(gtfsId: string) {
    favoriteStops.value = favoriteStops.value.filter((s) => s.gtfsId !== gtfsId);
  }

  return {
    favoriteLines,
    favoriteStops,
    toggleFavoriteLine,
    addFavoriteStop,
    removeFavoriteStop,
  };
}
