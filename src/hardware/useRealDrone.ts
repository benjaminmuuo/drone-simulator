import { useCallback, useEffect, useRef, useState } from 'react';
import type { DroneCommand } from '../parser/types';
import { DroneRunner } from './DroneRunner';
import type { RunOutcome } from './DroneRunner';
import { SerialLink, isWebSerialSupported } from './SerialLink';
import { loadCalibration, saveCalibration } from './calibrationStore';
import type { DroneStatus } from './protocol';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

export type RealFlight =
  | { readonly phase: 'idle' }
  | {
      readonly phase: 'flying';
      readonly commands: readonly DroneCommand[];
      readonly activeIndex: number | null;
      readonly landing: boolean;
      /** Shown while flying, e.g. contact lost and the drone may still be in the air. */
      readonly warning: string | null;
    }
  | { readonly phase: 'done'; readonly commands: readonly DroneCommand[]; readonly outcome: RunOutcome };

export interface RealDroneController {
  /** Web Serial is available (Chrome / Edge / Brave on a computer). */
  readonly supported: boolean;
  readonly connection: ConnectionState;
  readonly connectError: string | null;
  readonly status: DroneStatus | null;
  /** The drone has replied recently. */
  readonly answering: boolean;
  readonly flight: RealFlight;
  /** Reasons the program can't be flown right now (empty when not connected: connecting comes first). */
  preflight(commands: readonly DroneCommand[]): string[];
  connect(): void;
  disconnect(): void;
  fly(commands: readonly DroneCommand[]): void;
  /** Ends the flight and lands gently. */
  land(): void;
  /** Cuts the motors at once. */
  stop(): void;
  dismissResult(): void;
}

const IDLE: RealFlight = { phase: 'idle' };
/** How often "is the drone still answering?" is re-checked for display. */
const REFRESH_MS = 500;

const connectMessage = (e: unknown) => {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotFoundError') return null; // The student closed the picker: not an error.
  if (name === 'InvalidStateError' || name === 'NetworkError')
    return 'The controller is busy. Close other tabs that use it (such as Robolink Blockly), then try again.';
  return e instanceof Error ? e.message : String(e);
};

/** The USB link to a real CoDrone EDU, and flying a program on it. */
export function useRealDrone(): RealDroneController {
  const [supported] = useState(isWebSerialSupported);
  const [connection, setConnection] = useState<ConnectionState>('disconnected');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [status, setStatus] = useState<DroneStatus | null>(null);
  const [answering, setAnswering] = useState(false);
  const [flight, setFlight] = useState<RealFlight>(IDLE);
  const link = useRef<SerialLink | null>(null);
  const runner = useRef<DroneRunner | null>(null);

  const cleanup = useCallback(() => {
    runner.current?.dispose();
    runner.current = null;
    link.current = null;
    setConnection('disconnected');
    setStatus(null);
    setAnswering(false);
  }, []);

  const connect = useCallback(async () => {
    if (link.current) return;
    setConnectError(null);
    setConnection('connecting');
    let l: SerialLink;
    try {
      l = await SerialLink.request();
    } catch (e) {
      setConnectError(connectMessage(e));
      setConnection('disconnected');
      return;
    }
    // Start from what earlier flights (here or on the hardware test page) learned about the drone.
    const r = new DroneRunner(l, loadCalibration());
    link.current = l;
    runner.current = r;
    r.onStatus((s) => {
      setStatus(s);
      setAnswering(true);
    });
    void l.done.then(() => {
      if (link.current !== l) return;
      setConnectError('The controller was unplugged.');
      cleanup();
      void l.close();
    });
    setConnection('connected');
  }, [cleanup]);

  const disconnect = useCallback(async () => {
    if (runner.current?.isRunning) return;
    const l = link.current;
    cleanup();
    await l?.close();
  }, [cleanup]);

  const fly = useCallback(async (commands: readonly DroneCommand[]) => {
    const r = runner.current;
    if (!r || r.isRunning) return;
    setFlight({ phase: 'flying', commands, activeIndex: null, landing: false, warning: null });
    const outcome = await r.run(commands, {
      onStep: (activeIndex) => setFlight((f) => (f.phase === 'flying' ? { ...f, activeIndex } : f)),
      onWarning: (warning) => setFlight((f) => (f.phase === 'flying' ? { ...f, warning } : f)),
    });
    saveCalibration(r.calibration);
    setFlight({ phase: 'done', commands, outcome });
  }, []);

  const land = useCallback(() => {
    setFlight((f) => (f.phase === 'flying' ? { ...f, landing: true } : f));
    void runner.current?.abort();
  }, []);

  const stop = useCallback(() => void runner.current?.emergencyStop(), []);

  // Keep "answering" honest even when no new packets arrive.
  useEffect(() => {
    if (connection !== 'connected') return undefined;
    const id = window.setInterval(() => setAnswering(runner.current?.isAnswering ?? false), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [connection]);

  const flying = flight.phase === 'flying';

  // Space = emergency stop while flying. Safety beats every other use of the key.
  useEffect(() => {
    if (!flying) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      e.stopPropagation();
      stop();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [flying, stop]);

  // Leaving the page mid-flight lands the drone rather than leaving it flying.
  useEffect(() => {
    if (!flying) return undefined;
    const onLeave = () => void runner.current?.abort();
    const onHidden = () => document.hidden && onLeave();
    window.addEventListener('pagehide', onLeave);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', onLeave);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [flying]);

  // Unmounting closes the port (landing first if needed).
  useEffect(
    () => () => {
      const r = runner.current;
      const l = link.current;
      if (r?.isRunning) void r.abort();
      r?.dispose();
      void l?.close();
    },
    [],
  );

  // Re-evaluated on every render; `status` / `answering` updates are what trigger those.
  const preflight = (commands: readonly DroneCommand[]) => runner.current?.preflight(commands) ?? [];

  return {
    supported,
    connection,
    connectError,
    status,
    answering,
    flight,
    preflight,
    connect: () => void connect(),
    disconnect: () => void disconnect(),
    fly: (commands) => void fly(commands),
    land,
    stop,
    dismissResult: () => setFlight(IDLE),
  };
}
