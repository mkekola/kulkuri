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
  // Bare gtfsId (no "HSL:" prefix) - same id space as HFP's route field and
  // RouteSummary.route, for matching against fetchTrunkRouteIds() etc.
  routeId: string;
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
          gtfsId
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
      trip: { route: { gtfsId: string; shortName: string | null; mode: string | null } };
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
    routeId: st.trip.route.gtfsId.replace(/^HSL:/, ''),
    mode: (st.trip.route.mode ?? '').toLowerCase(),
    headsign: st.headsign ?? '',
    departureAt: (st.serviceDay + st.realtimeDeparture) * 1000,
    realtime: st.realtime,
  }));
}

export interface RouteEndpoints {
  origin: string;
  destination: string;
}

const ROUTE_ENDPOINTS_QUERY = `query RouteEndpoints($id: String!) {
  route(id: $id) {
    patterns {
      directionId
      stops {
        name
      }
    }
  }
}`;

interface RouteEndpointsResponse {
  route: { patterns: { directionId: number; stops: { name: string }[] }[] } | null;
}

const routeEndpointsCache = new Map<string, Promise<Record<number, RouteEndpoints>>>();

// First/last stop name for each direction of a route (e.g. direction 0:
// Mellunmäki -> Tapiola, direction 1: Tapiola -> Mellunmäki). A route can
// list several pattern variants per direction (short-turns etc.); the one
// with the most stops is taken as the representative full route. Cached per
// route for the session since this never changes while the app is open.
export function fetchRouteEndpoints(routeId: string): Promise<Record<number, RouteEndpoints>> {
  const cached = routeEndpointsCache.get(routeId);
  if (cached) return cached;

  const promise = graphql<RouteEndpointsResponse>(ROUTE_ENDPOINTS_QUERY, {
    id: `HSL:${routeId}`,
  }).then((data) => {
    const longestByDirection = new Map<number, { name: string }[]>();
    for (const pattern of data?.route?.patterns ?? []) {
      if (pattern.stops.length < 2) continue;
      const longest = longestByDirection.get(pattern.directionId);
      if (!longest || pattern.stops.length > longest.length) {
        longestByDirection.set(pattern.directionId, pattern.stops);
      }
    }
    const result: Record<number, RouteEndpoints> = {};
    for (const [directionId, stops] of longestByDirection) {
      result[directionId] = { origin: stops[0].name, destination: stops[stops.length - 1].name };
    }
    return result;
  });

  routeEndpointsCache.set(routeId, promise);
  return promise;
}

export interface RouteSummary {
  // Bare route id, no "HSL:" prefix - matches HFP's vp.route, same as every
  // other routeId in this file once the prefix is stripped back off.
  route: string;
  shortName: string | null;
  mode: string;
  isTrunk: boolean;
}

// HSL has no dedicated "is this a runkolinja" field in its GTFS feed, but
// tags every trunk bus line with the extended route_type 702 ("Express Bus
// Service" per the GTFS spec, repurposed here) - verified against the live
// feed: routes with type 702 are exactly HSL's published runkolinjasto (20,
// 30, 40, 200, 300, 400, 500, 510, 520, 530, 560, 570, 570N, 600), nothing
// else.
const TRUNK_ROUTE_TYPE = 702;

const ALL_ROUTES_QUERY = `query AllRoutes {
  routes {
    gtfsId
    shortName
    mode
    type
  }
}`;

let allRoutesPromise: Promise<RouteSummary[]> | undefined;

// Every HSL route, regardless of whether it currently has a vehicle on it -
// for the sidebar's "show all lines" toggle, which the live vehicle feed
// alone can't answer. Fetched once and cached for the session: the route
// list itself doesn't change while the app is open, only which of them
// happen to be running right now.
export function fetchAllRoutes(): Promise<RouteSummary[]> {
  allRoutesPromise ??= graphql<{
    routes: { gtfsId: string; shortName: string | null; mode: string | null; type: number | null }[];
  }>(ALL_ROUTES_QUERY, {}).then((data) =>
    (data?.routes ?? []).map((route) => ({
      route: route.gtfsId.replace(/^HSL:/, ''),
      shortName: route.shortName,
      mode: route.mode ?? '',
      isTrunk: route.type === TRUNK_ROUTE_TYPE,
    })),
  );
  return allRoutesPromise;
}

// Just the trunk route ids, for badge coloring - shares fetchAllRoutes()'s
// own cached request rather than firing a second one.
export function fetchTrunkRouteIds(): Promise<Set<string>> {
  return fetchAllRoutes().then(
    (routes) => new Set(routes.filter((route) => route.isTrunk).map((route) => route.route)),
  );
}
