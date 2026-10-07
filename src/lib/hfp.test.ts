import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mqtt, { type MqttClient } from 'mqtt';
import {
  FLUSH_INTERVAL_MS,
  STALE_AFTER_MS,
  connectVehiclePositions,
  isStaleFix,
  journeyKey,
  parseMode,
  parseVehicleId,
} from './hfp';

vi.mock('mqtt', () => ({ default: { connect: vi.fn() } }));

// A realistic HFP topic: /hfp/v2/journey/ongoing/vp/<mode>/<operator>/<vehicle>/...
function topicFor(mode: string, vehicleId: string): string {
  const [operator, vehicle] = vehicleId.split('/');
  return `/hfp/v2/journey/ongoing/vp/${mode}/${operator}/${vehicle}/30/1/Rautatientori/12:00`;
}

function vpPayload(overrides: Record<string, unknown> = {}) {
  return {
    VP: {
      desi: '30',
      lat: 60.17,
      long: 24.94,
      hdg: 90,
      spd: 10,
      route: '30',
      dir: '1',
      oday: '2024-01-15',
      start: '12:00',
      tst: '2024-01-15T12:00:00.000Z',
      ...overrides,
    },
  };
}

describe('parseMode', () => {
  it('reads the mode segment out of an HFP topic', () => {
    expect(parseMode(topicFor('bus', '0012/01234'))).toBe('bus');
  });

  it('falls back to "unknown" for a malformed topic', () => {
    expect(parseMode('/too/short')).toBe('unknown');
  });
});

describe('parseVehicleId', () => {
  it('joins operator and vehicle number from an HFP topic', () => {
    expect(parseVehicleId(topicFor('bus', '0012/01234'))).toBe('0012/01234');
  });

  it('falls back to "0/0" for a malformed topic', () => {
    expect(parseVehicleId('/too/short')).toBe('0/0');
  });
});

describe('journeyKey', () => {
  it('combines route/dir/oday/start when all are present', () => {
    expect(journeyKey(vpPayload().VP)).toBe('30/1/2024-01-15/12:00');
  });

  it('returns null if any of route/dir/oday/start is missing', () => {
    expect(journeyKey(vpPayload({ route: null }).VP)).toBeNull();
    expect(journeyKey(vpPayload({ dir: null }).VP)).toBeNull();
    expect(journeyKey(vpPayload({ oday: null }).VP)).toBeNull();
    expect(journeyKey(vpPayload({ start: null }).VP)).toBeNull();
  });
});

// A minimal stand-in for MqttClient - just enough of the EventEmitter
// surface connectVehiclePositions() actually uses (on/subscribe/end),
// plus emit() for tests to fire messages through it.
class FakeMqttClient {
  private handlers = new Map<string, ((...args: never[]) => void)[]>();
  subscribe = vi.fn();
  end = vi.fn();

  on(event: string, handler: (...args: never[]) => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  emit(event: string, ...args: never[]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }
}

describe('connectVehiclePositions', () => {
  let client: FakeMqttClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new FakeMqttClient();
    vi.mocked(mqtt.connect).mockReturnValue(client as unknown as MqttClient);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits a feature per vehicle after the flush interval', () => {
    const onUpdate = vi.fn();
    const disconnect = connectVehiclePositions(onUpdate);

    client.emit(
      'message',
      topicFor('bus', '12/1') as never,
      Buffer.from(JSON.stringify(vpPayload())) as never,
    );
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS);

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const collection = onUpdate.mock.calls[0][0];
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].properties.vehicleId).toBe('12/1');
    expect(collection.features[0].properties.mode).toBe('bus');

    disconnect();
  });

  it('collapses a coupled pair sharing one journey into a single marker', () => {
    const onUpdate = vi.fn();
    const disconnect = connectVehiclePositions(onUpdate);
    const shared = vpPayload();

    // '10/002' arrives first - the leader is chosen by sorting vehicleId,
    // not arrival order, so it should still lose to '10/001' below.
    client.emit(
      'message',
      topicFor('train', '10/002') as never,
      Buffer.from(JSON.stringify(shared)) as never,
    );
    client.emit(
      'message',
      topicFor('train', '10/001') as never,
      Buffer.from(JSON.stringify(shared)) as never,
    );
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS);

    const collection = onUpdate.mock.calls.at(-1)?.[0];
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].properties.vehicleId).toBe('10/001');

    disconnect();
  });

  it('keeps two vehicles on the same route separate when they are not a coupled pair', () => {
    const onUpdate = vi.fn();
    const disconnect = connectVehiclePositions(onUpdate);

    client.emit(
      'message',
      topicFor('bus', '12/1') as never,
      Buffer.from(JSON.stringify(vpPayload({ dir: '1' }))) as never,
    );
    client.emit(
      'message',
      topicFor('bus', '12/2') as never,
      Buffer.from(JSON.stringify(vpPayload({ dir: '2' }))) as never,
    );
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS);

    const collection = onUpdate.mock.calls.at(-1)?.[0];
    expect(collection.features).toHaveLength(2);

    disconnect();
  });

  it('drops a vehicle once it reports the "X" out-of-service sign', () => {
    const onUpdate = vi.fn();
    const disconnect = connectVehiclePositions(onUpdate);

    client.emit(
      'message',
      topicFor('bus', '12/1') as never,
      Buffer.from(JSON.stringify(vpPayload())) as never,
    );
    client.emit(
      'message',
      topicFor('bus', '12/1') as never,
      Buffer.from(JSON.stringify(vpPayload({ desi: 'X' }))) as never,
    );
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS);

    const collection = onUpdate.mock.calls.at(-1)?.[0];
    expect(collection.features).toHaveLength(0);

    disconnect();
  });

  it('drops a vehicle that has gone stale', () => {
    const onUpdate = vi.fn();
    const disconnect = connectVehiclePositions(onUpdate);

    client.emit(
      'message',
      topicFor('bus', '12/1') as never,
      Buffer.from(JSON.stringify(vpPayload())) as never,
    );
    vi.advanceTimersByTime(STALE_AFTER_MS + FLUSH_INTERVAL_MS);

    const collection = onUpdate.mock.calls.at(-1)?.[0];
    expect(collection.features).toHaveLength(0);

    disconnect();
  });

  it('stops the flush timer and the mqtt client on disconnect', () => {
    const onUpdate = vi.fn();
    const disconnect = connectVehiclePositions(onUpdate);

    disconnect();
    onUpdate.mockClear();
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS * 5);

    expect(onUpdate).not.toHaveBeenCalled();
    expect(client.end).toHaveBeenCalledWith(true);
  });
});

describe('isStaleFix', () => {
  const at = (iso: string) => Date.parse(iso);

  it('keeps the first fix a vehicle sends', () => {
    expect(isStaleFix(undefined, '2026-10-07T18:00:00.000Z')).toBe(false);
  });

  it('keeps a fix newer than the one already held', () => {
    expect(isStaleFix(at('2026-10-07T18:00:00.000Z'), '2026-10-07T18:00:01.000Z')).toBe(false);
  });

  // The whole point: a vehicle that lost connectivity republishes its backlog,
  // and taking the last arrival drags its marker backwards along the route.
  it('drops a fix older than the one already held', () => {
    expect(isStaleFix(at('2026-10-07T18:00:05.000Z'), '2026-10-07T18:00:01.000Z')).toBe(true);
  });

  // One-second resolution plus a slightly faster publish rate makes these
  // common; they cannot move a marker backwards, so they are not worth losing.
  it('keeps a repeat within the same second', () => {
    expect(isStaleFix(at('2026-10-07T18:00:05.000Z'), '2026-10-07T18:00:05.000Z')).toBe(false);
  });

  it('takes an untimestamped or unparseable fix on trust, having no way to order it', () => {
    expect(isStaleFix(at('2026-10-07T18:00:05.000Z'), null)).toBe(false);
    expect(isStaleFix(at('2026-10-07T18:00:05.000Z'), 'not a date')).toBe(false);
  });
});
