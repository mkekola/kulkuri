const ENDPOINT = 'https://api.digitransit.fi/routing/v2/hsl/gtfs/v1';
const QUERY = `query RoutePaths($id: String!) {
  route(id: $id) {
    patterns {
      geometry {
        lat
        lon
      }
    }
  }
}`;
const STOP_SEARCH_QUERY = `query StopSearch($name: String!) {
  stops(name: $name) {
    gtfsId
    name
    code
    lat
    lon
  }
}`;
const STOP_SEARCH_LIMIT = 15;

interface RouteQueryResponse {
  data?: {
    route: { patterns: { geometry: { lat: number; lon: number }[] }[] } | null;
  };
}

export interface StopResult {
  gtfsId: string;
  name: string;
  code: string | null;
  lat: number;
  lon: number;
}

interface StopSearchResponse {
  data?: { stops: StopResult[] };
}

export type RoutePath = [number, number][];

// Full shape of a line's route(s), one path per direction/branch. Requires a
// free Digitransit subscription key (see .env.example); returns no paths
// without one instead of failing the whole app.
export async function fetchRoutePaths(routeId: string): Promise<RoutePath[]> {
  const apiKey = import.meta.env.VITE_DIGITRANSIT_API_KEY as string | undefined;
  if (!apiKey) return [];

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'digitransit-subscription-key': apiKey,
    },
    body: JSON.stringify({ query: QUERY, variables: { id: `HSL:${routeId}` } }),
  });
  if (!response.ok) return [];

  const json = (await response.json()) as RouteQueryResponse;
  const patterns = json.data?.route?.patterns ?? [];
  return patterns.map((pattern) =>
    pattern.geometry.map((point): [number, number] => [point.lon, point.lat]),
  );
}

// Stop name search for the favorites tab. Digitransit matches by platform, so
// a common name like "Rautatientori" returns many individual stops/tracks.
export async function searchStops(query: string): Promise<StopResult[]> {
  const apiKey = import.meta.env.VITE_DIGITRANSIT_API_KEY as string | undefined;
  const trimmed = query.trim();
  if (!apiKey || trimmed.length < 2) return [];

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'digitransit-subscription-key': apiKey,
    },
    body: JSON.stringify({ query: STOP_SEARCH_QUERY, variables: { name: trimmed } }),
  });
  if (!response.ok) return [];

  const json = (await response.json()) as StopSearchResponse;
  return (json.data?.stops ?? []).slice(0, STOP_SEARCH_LIMIT);
}
