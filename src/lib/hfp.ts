import mqtt from 'mqtt';
import type { Feature, FeatureCollection, Point } from 'geojson';

const BROKER_URL = 'wss://mqtt.hsl.fi:443/';
const TOPIC = '/hfp/v2/journey/ongoing/vp/#';
export const FLUSH_INTERVAL_MS = 1000;
// A vehicle that hasn't sent a position in this long has likely ended its
// journey (HFP stops publishing for it) rather than just gone quiet.
const STALE_AFTER_MS = 30_000;

export interface VehicleProperties {
  vehicleId: string;
  mode: string;
  route: string | null;
  line: string | null;
  heading: number | null;
  speed: number | null;
  // "1" or "2" - HSL's 1-indexed take on GTFS direction_id (0/1).
  dir: string | null;
  // Seconds behind schedule (negative = running early) - HFP's own live
  // figure, not derived from anything else. null before the vehicle's
  // first HFP message has reported one (e.g. just starting its trip).
  delay: number | null;
}

interface HfpVehiclePosition {
  desi: string | null;
  lat: number | null;
  long: number | null;
  hdg: number | null;
  spd: number | null;
  route: string | null;
  dir: string | null;
  // Operating day + scheduled start time of the trip - together with
  // route/dir, HSL's own recommended way to tell whether two HFP messages
  // belong to the same journey. See journeyKey() below.
  oday: string | null;
  start: string | null;
  dl: number | null;
}

function parseMode(topic: string): string {
  return topic.split('/')[6] ?? 'unknown';
}

function parseVehicleId(topic: string): string {
  const parts = topic.split('/');
  const operator = parts[7] ?? '0';
  const vehicle = parts[8] ?? '0';
  return `${operator}/${vehicle}`;
}

// Trains and metros sometimes run as two physically coupled units sharing
// one scheduled trip, each reporting its own HFP position - without this,
// that's two markers sitting almost exactly on top of each other for what
// a rider sees as a single train. Units on the same trip all report the
// same route, direction, operating day and start time; anything missing
// one of those fields (depot moves, degraded messages) just isn't grouped.
function journeyKey(vp: HfpVehiclePosition): string | null {
  if (!vp.route || !vp.dir || !vp.oday || !vp.start) return null;
  return `${vp.route}/${vp.dir}/${vp.oday}/${vp.start}`;
}

export function connectVehiclePositions(
  onUpdate: (features: FeatureCollection<Point, VehicleProperties>) => void,
): () => void {
  const vehicles = new Map<string, Feature<Point, VehicleProperties>>();
  const lastSeen = new Map<string, number>();
  const journeyKeys = new Map<string, string | null>();

  const client = mqtt.connect(BROKER_URL);

  client.on('connect', () => {
    client.subscribe(TOPIC);
  });

  client.on('message', (topic, payload) => {
    try {
      const data = JSON.parse(payload.toString()) as { VP?: HfpVehiclePosition };
      const vp = data.VP;
      if (!vp || vp.lat == null || vp.long == null) return;

      const vehicleId = parseVehicleId(topic);

      // "X" is the physical destination sign HSL vehicles show when out of
      // service (heading to/from the depot, other non-passenger runs) - not
      // a real line, so drop it instead of showing a bogus "X" marker (and
      // a bogus "X" row in the sidebar's line list).
      if (vp.desi === 'X') {
        vehicles.delete(vehicleId);
        lastSeen.delete(vehicleId);
        journeyKeys.delete(vehicleId);
        return;
      }

      vehicles.set(vehicleId, {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [vp.long, vp.lat] },
        properties: {
          vehicleId,
          mode: parseMode(topic),
          route: vp.route,
          line: vp.desi,
          heading: vp.hdg,
          speed: vp.spd,
          dir: vp.dir,
          delay: vp.dl,
        },
      });
      lastSeen.set(vehicleId, Date.now());
      journeyKeys.set(vehicleId, journeyKey(vp));
    } catch {
      // Ignore malformed messages.
    }
  });

  const flush = window.setInterval(() => {
    const now = Date.now();
    for (const [vehicleId, seenAt] of lastSeen) {
      if (now - seenAt > STALE_AFTER_MS) {
        vehicles.delete(vehicleId);
        lastSeen.delete(vehicleId);
        journeyKeys.delete(vehicleId);
      }
    }

    // One marker per journey: whichever coupled unit's vehicleId sorts
    // first represents the pair, consistently flush to flush (arrival
    // order on the MQTT topic isn't reliable) - the other unit's own
    // position is still tracked above, just not emitted as its own marker.
    const leaderByJourney = new Map<string, string>();
    for (const vehicleId of vehicles.keys()) {
      const key = journeyKeys.get(vehicleId);
      if (!key) continue;
      const currentLeader = leaderByJourney.get(key);
      if (!currentLeader || vehicleId < currentLeader) leaderByJourney.set(key, vehicleId);
    }
    const features: Feature<Point, VehicleProperties>[] = [];
    for (const [vehicleId, feature] of vehicles) {
      const key = journeyKeys.get(vehicleId);
      if (key && leaderByJourney.get(key) !== vehicleId) continue;
      features.push(feature);
    }

    onUpdate({ type: 'FeatureCollection', features });
  }, FLUSH_INTERVAL_MS);

  return () => {
    window.clearInterval(flush);
    client.end(true);
  };
}
