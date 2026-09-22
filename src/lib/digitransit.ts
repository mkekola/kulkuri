const ENDPOINT = 'https://api.digitransit.fi/routing/v2/hsl/gtfs/v1';
const STOP_SEARCH_LIMIT = 15;
const DEPARTURES_LIMIT = 6;

async function graphql<T>(query: string, variables: object): Promise<T | undefined> {
  const apiKey = import.meta.env.VITE_DIGITRANSIT_API_KEY as string | undefined;
  if (!apiKey) return undefined;

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'digitransit-subscription-key': apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) return undefined;

  const json = (await response.json()) as { data?: T };
  return json.data;
}

export type RoutePath = [number, number][];

const ROUTE_PATHS_QUERY = `query RoutePaths($id: String!) {
  route(id: $id) {
    patterns {
      geometry {
        lat
        lon
      }
    }
  }
}`;

// Full shape of a line's route(s), one path per direction/branch. Requires a
// free Digitransit subscription key (see .env.example); returns no paths
// without one instead of failing the whole app.
export async function fetchRoutePaths(routeId: string): Promise<RoutePath[]> {
  const data = await graphql<{
    route: { patterns: { geometry: { lat: number; lon: number }[] }[] } | null;
  }>(ROUTE_PATHS_QUERY, { id: `HSL:${routeId}` });
  const patterns = data?.route?.patterns ?? [];
  return patterns.map((pattern) =>
    pattern.geometry.map((point): [number, number] => [point.lon, point.lat]),
  );
}

export interface StopResult {
  gtfsId: string;
  name: string;
  code: string | null;
  lat: number;
  lon: number;
  vehicleMode?: string;
}

const STOP_SEARCH_QUERY = `query StopSearch($name: String!) {
  stops(name: $name) {
    gtfsId
    name
    code
    lat
    lon
    vehicleMode
  }
}`;

// Stop name search for the favorites tab. Digitransit matches by platform, so
// a common name like "Rautatientori" returns many individual stops/tracks.
export async function searchStops(query: string): Promise<StopResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const data = await graphql<{ stops: StopResult[] }>(STOP_SEARCH_QUERY, { name: trimmed });
  return (data?.stops ?? []).slice(0, STOP_SEARCH_LIMIT);
}

export interface MapBounds {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

const STOPS_BY_BBOX_QUERY = `query StopsByBbox($minLat: Float!, $minLon: Float!, $maxLat: Float!, $maxLon: Float!) {
  stopsByBbox(minLat: $minLat, minLon: $minLon, maxLat: $maxLat, maxLon: $maxLon) {
    gtfsId
    name
    code
    lat
    lon
    vehicleMode
  }
}`;

// Stops within the visible map area, for the always-on stop markers. Only
// called once the map is zoomed in enough that this stays a reasonable list.
export async function fetchStopsInBounds(bounds: MapBounds): Promise<StopResult[]> {
  const data = await graphql<{ stopsByBbox: StopResult[] }>(STOPS_BY_BBOX_QUERY, bounds);
  return data?.stopsByBbox ?? [];
}

export interface Departure {
  route: string;
  mode: string;
  headsign: string;
  departureAt: number; // epoch ms
  realtime: boolean;
}

const STOP_DEPARTURES_QUERY = `query StopDepartures($id: String!, $numberOfDepartures: Int!) {
  stop(id: $id) {
    name
    code
    stoptimesWithoutPatterns(numberOfDepartures: $numberOfDepartures) {
      scheduledDeparture
      realtimeDeparture
      realtime
      serviceDay
      headsign
      trip {
        route {
          shortName
          mode
        }
      }
    }
  }
}`;

interface StopDeparturesResponse {
  stop: {
    name: string;
    code: string | null;
    stoptimesWithoutPatterns: {
      scheduledDeparture: number;
      realtimeDeparture: number;
      realtime: boolean;
      serviceDay: number;
      headsign: string | null;
      trip: { route: { shortName: string | null; mode: string | null } };
    }[];
  } | null;
}

// Next departures from a stop, most imminent first. `serviceDay` is midnight
// (epoch seconds) of the operating day; departure seconds can run past 86400
// for trips that started the previous day, so this still lands on the right
// real-world moment.
export async function fetchStopDepartures(gtfsId: string): Promise<Departure[]> {
  const data = await graphql<StopDeparturesResponse>(STOP_DEPARTURES_QUERY, {
    id: gtfsId,
    numberOfDepartures: DEPARTURES_LIMIT,
  });
  const stoptimes = data?.stop?.stoptimesWithoutPatterns ?? [];
  return stoptimes.map((st) => ({
    route: st.trip.route.shortName ?? '–',
    mode: (st.trip.route.mode ?? '').toLowerCase(),
    headsign: st.headsign ?? '',
    departureAt: (st.serviceDay + st.realtimeDeparture) * 1000,
    realtime: st.realtime,
  }));
}
