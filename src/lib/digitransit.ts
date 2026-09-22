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

interface RouteQueryResponse {
  data?: {
    route: { patterns: { geometry: { lat: number; lon: number }[] }[] } | null;
  };
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
