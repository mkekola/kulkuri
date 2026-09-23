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
}

interface HfpVehiclePosition {
  desi: string | null;
  lat: number | null;
  long: number | null;
  hdg: number | null;
  spd: number | null;
  route: string | null;
  dir: string | null;
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

export function connectVehiclePositions(
  onUpdate: (features: FeatureCollection<Point, VehicleProperties>) => void,
): () => void {
  const vehicles = new Map<string, Feature<Point, VehicleProperties>>();
  const lastSeen = new Map<string, number>();

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
        },
      });
      lastSeen.set(vehicleId, Date.now());
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
      }
    }
    onUpdate({ type: 'FeatureCollection', features: Array.from(vehicles.values()) });
  }, FLUSH_INTERVAL_MS);

  return () => {
    window.clearInterval(flush);
    client.end(true);
  };
}
