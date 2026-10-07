import { describe, expect, it } from 'vitest';
import {
  labelPriority,
  vehicleDiscId,
  VEHICLE_LABEL_MIN_ZOOM,
  VEHICLE_LABEL_FULL_ZOOM,
} from './vehicleMarkers';

describe('labelPriority', () => {
  it('ranks rarer modes ahead of buses', () => {
    const ranked = ['bus', 'tram', 'ferry', 'metro', 'train']
      .map((mode) => ({ mode, key: labelPriority(mode, false) }))
      .sort((a, b) => a.key - b.key)
      .map((r) => r.mode);
    expect(ranked).toEqual(['train', 'metro', 'ferry', 'tram', 'bus']);
  });

  it('puts the selected line ahead of every unselected vehicle', () => {
    const slowestSelected = labelPriority('bus', true);
    const fastestUnselected = labelPriority('train', false);
    expect(slowestSelected).toBeLessThan(fastestUnselected);
  });

  it('keeps mode order within the selected line', () => {
    expect(labelPriority('train', true)).toBeLessThan(labelPriority('bus', true));
  });

  it('sorts an unrecognized mode last rather than throwing', () => {
    expect(labelPriority('funicular', false)).toBeGreaterThan(labelPriority('bus', false));
  });
});

describe('vehicleDiscId', () => {
  it('namespaces the image id per mode', () => {
    expect(vehicleDiscId('tram')).toBe('vehicle-disc-tram');
    expect(vehicleDiscId('bus')).not.toBe(vehicleDiscId('tram'));
  });
});

describe('zoom gate', () => {
  it('fades in over a range rather than switching at one zoom', () => {
    expect(VEHICLE_LABEL_MIN_ZOOM).toBeLessThan(VEHICLE_LABEL_FULL_ZOOM);
  });
});
