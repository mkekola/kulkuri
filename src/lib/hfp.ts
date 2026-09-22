import mqtt from 'mqtt';
import type { Feature, FeatureCollection, Point } from 'geojson';

const BROKER_URL = 'wss://mqtt.hsl.fi:443/';
const TOPIC = '/hfp/v2/journey/ongoing/vp/#';
export const FLUSH_INTERVAL_MS = 1000;

export interface VehicleProperties {
  vehicleId: string;
  mode: string;
  route: string | null;
  line: string | null;
  heading: number | null;
  speed: number | null;
}

interface HfpVehiclePosition {
  desi: string | null;
  lat: number | null;
  long: number | null;
  hdg: number | null;
  spd: number | null;
  route: string | null;
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
        },
      });
    } catch {
      // Ignore malformed messages.
    }
  });

  const flush = window.setInterval(() => {
    onUpdate({ type: 'FeatureCollection', features: Array.from(vehicles.values()) });
  }, FLUSH_INTERVAL_MS);

  return () => {
    window.clearInterval(flush);
    client.end(true);
  };
}
