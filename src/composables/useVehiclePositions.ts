import { onUnmounted, ref, shallowRef } from 'vue';
import { connectVehiclePositions, type VehicleProperties } from '../lib/hfp';
import type { Feature, Point } from 'geojson';

export type VehicleMap = Map<string, Feature<Point, VehicleProperties>>;

export function useVehiclePositions() {
  const vehicles = shallowRef<VehicleMap>(new Map());
  // False until the first HFP flush arrives - lets callers tell "still
  // connecting" apart from "connected, genuinely nothing running", which
  // an empty vehicles Map alone can't distinguish (see AppSidebar.vue's
  // own hasLoaded-gated empty-state text).
  const hasLoaded = ref(false);

  const disconnect = connectVehiclePositions((collection) => {
    const next: VehicleMap = new Map();
    for (const feature of collection.features) {
      next.set(feature.properties.vehicleId, feature);
    }
    vehicles.value = next;
    hasLoaded.value = true;
  });

  onUnmounted(disconnect);

  return { vehicles, hasLoaded };
}
