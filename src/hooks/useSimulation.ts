import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildTimeline, frameAt, trailAt } from '../animation/timeline';
import type { PlaybackFrame, Timeline } from '../animation/timeline';
import { simulate } from '../engine/SimulationEngine';
import type { SimulationResult } from '../engine/types';
import type { MazeDefinition, Point } from '../mazes/types';
import type { DroneCommand } from '../parser/types';

export type PlaybackPhase = 'idle' | 'running' | 'paused' | 'finished';

export const PLAYBACK_SPEEDS = [0.5, 1, 2, 4] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/**
 * Longest real-time gap applied in one frame, so returning to a backgrounded
 * tab doesn't skip steps, while slow (low-fps) computers still play in real time.
 */
const MAX_FRAME_SECONDS = 0.25;

export interface SimulationController {
  readonly result: SimulationResult | null;
  readonly timeline: Timeline;
  /** Simulated seconds played so far. */
  readonly elapsed: number;
  readonly phase: PlaybackPhase;
  readonly frame: PlaybackFrame;
  readonly trail: readonly Point[];
  readonly visitedCheckpoints: ReadonlySet<string>;
  readonly speed: PlaybackSpeed;
  run(): void;
  pause(): void;
  resume(): void;
  reset(): void;
  setSpeed(speed: PlaybackSpeed): void;
}

/**
 * The full program is simulated up front (authoritative); playback then just
 * advances a clock through the derived timeline.
 */
export function useSimulation(
  commands: readonly DroneCommand[] | null,
  maze: MazeDefinition,
  flightHeightCm: number,
): SimulationController {
  const result = useMemo(
    () => (commands ? simulate(commands, maze, { flightHeightCm }) : null),
    [commands, maze, flightHeightCm],
  );
  const timeline = useMemo(
    () => (result ? buildTimeline(result, maze) : { initialPose: { ...maze.start, headingDeg: maze.startHeadingDeg, altitude: 0 }, segments: [], totalSeconds: 0 }),
    [result, maze],
  );

  const [phase, setPhase] = useState<PlaybackPhase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  // A new program or maze always starts from a clean slate.
  useEffect(() => {
    setPhase('idle');
    setElapsed(0);
  }, [timeline]);

  useEffect(() => {
    if (phase !== 'running') return undefined;
    let handle = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      if (last !== null) {
        const dt = Math.min((now - last) / 1000, MAX_FRAME_SECONDS) * speedRef.current;
        setElapsed((prev) => Math.min(prev + dt, timeline.totalSeconds));
      }
      last = now;
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [phase, timeline]);

  useEffect(() => {
    if (phase === 'running' && elapsed >= timeline.totalSeconds) setPhase('finished');
  }, [phase, elapsed, timeline]);

  const frame = useMemo(() => frameAt(timeline, elapsed), [timeline, elapsed]);
  const trail = useMemo(() => trailAt(timeline, elapsed), [timeline, elapsed]);
  const visitedCheckpoints = useMemo(() => {
    const visited = new Set<string>();
    result?.steps.slice(0, frame.completedSteps).forEach((step) => step.checkpointsCollected.forEach((id) => visited.add(id)));
    return visited;
  }, [result, frame.completedSteps]);

  const run = useCallback(() => {
    if (!result) return;
    setElapsed(0);
    setPhase(timeline.totalSeconds > 0 ? 'running' : 'finished');
  }, [result, timeline]);
  const pause = useCallback(() => setPhase((p) => (p === 'running' ? 'paused' : p)), []);
  const resume = useCallback(() => setPhase((p) => (p === 'paused' ? 'running' : p)), []);
  const reset = useCallback(() => {
    setPhase('idle');
    setElapsed(0);
  }, []);

  return { result, timeline, elapsed, phase, frame, trail, visitedCheckpoints, speed, run, pause, resume, reset, setSpeed };
}
