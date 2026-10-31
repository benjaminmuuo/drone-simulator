import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRealDrone } from '../hardware/useRealDrone';
import type { DroneCommand } from '../parser/types';
import { FLIGHT, FakeDrone } from './fakeDrone';

/** The fake drone, dressed up as an open SerialLink. */
class FakeLink extends FakeDrone {
  unplug!: () => void;
  readonly done = new Promise<void>((resolve) => (this.unplug = resolve));
  readonly close = vi.fn(async () => {});
}

let link: FakeLink;
const request = vi.fn();

vi.mock('../hardware/SerialLink', () => ({
  isWebSerialSupported: () => true,
  SerialLink: { request: () => request() },
}));

const PROGRAM: readonly DroneCommand[] = [
  { type: 'TAKEOFF', blockId: 'b1' },
  { type: 'HOVER', durationSeconds: 30, blockId: 'b2' },
  { type: 'LAND', blockId: 'b3' },
];

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

async function connected() {
  const hook = renderHook(() => useRealDrone());
  act(() => hook.result.current.connect());
  await advance(600);
  expect(hook.result.current.connection).toBe('connected');
  expect(hook.result.current.answering).toBe(true);
  return hook;
}

beforeEach(() => {
  vi.useFakeTimers();
  link = new FakeLink();
  request.mockReset().mockResolvedValue(link);
});

afterEach(() => vi.useRealTimers());

describe('useRealDrone', () => {
  it('connects, reports battery, flies and highlights each step', async () => {
    const { result } = await connected();
    expect(result.current.status?.battery).toBe(90);

    act(() => result.current.fly(PROGRAM));
    await advance(5000);
    expect(result.current.flight).toMatchObject({ phase: 'flying', activeIndex: 1 });
    // The 500 ms "still answering?" re-check has run many times by now.
    expect(result.current.answering).toBe(true);

    act(() => result.current.land());
    await advance(3000);
    expect(result.current.flight).toMatchObject({ phase: 'done', outcome: { status: 'ABORTED' } });
    expect(link.events).toEqual(['TAKEOFF', 'LAND']);
  });

  it('Space cuts the motors during a flight', async () => {
    const { result } = await connected();
    act(() => result.current.fly(PROGRAM));
    await advance(5000);

    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })));
    await advance(500);
    expect(link.events).toContain('STOP');
    expect(result.current.flight).toMatchObject({ phase: 'done', outcome: { status: 'STOPPED' } });
  });

  it('lands when the page is hidden mid-flight', async () => {
    const { result } = await connected();
    act(() => result.current.fly(PROGRAM));
    await advance(5000);

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await advance(3000);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });

    expect(link.events).toEqual(['TAKEOFF', 'LAND']);
    expect(link.flight).toBe(FLIGHT.Ready);
  });

  it('reports an unplugged controller', async () => {
    const { result } = await connected();
    act(() => link.unplug());
    await advance(10);
    expect(result.current.connection).toBe('disconnected');
    expect(result.current.connectError).toMatch(/unplugged/);
  });

  it('treats closing the port picker as "not now", and a busy port as an error', async () => {
    const { result } = renderHook(() => useRealDrone());
    request.mockRejectedValueOnce(new DOMException('No port selected', 'NotFoundError'));
    act(() => result.current.connect());
    await advance(10);
    expect(result.current.connectError).toBeNull();

    request.mockRejectedValueOnce(new DOMException('Failed to open serial port', 'InvalidStateError'));
    act(() => result.current.connect());
    await advance(10);
    expect(result.current.connectError).toMatch(/busy/);
  });
});
