import { onUnmounted, shallowRef } from 'vue';
import { connectVehiclePositions, type VehicleProperties } from '../lib/hfp';
import type { Feature, Point } from 'geojson';

export type VehicleMap = Map<string, Feature<Point, VehicleProperties>>;

export function useVehiclePositions() {
  const vehicles = shallowRef<VehicleMap>(new Map());

  const disconnect = connectVehiclePositions((collection) => {
    const next: VehicleMap = new Map();
    for (const feature of collection.features) {
      next.set(feature.properties.vehicleId, feature);
    }
    vehicles.value = next;
  });

  onUnmounted(disconnect);

  return { vehicles };
}
