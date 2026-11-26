/**
 * Converts an authoritative SimulationResult into a playback timeline.
 * Pure and read-only: animation can never change simulation outcomes.
 */
import type { SimulationResult } from '../engine/types';
import type { MazeDefinition, Point } from '../mazes/types';

export interface Pose {
  readonly x: number;
  readonly y: number;
  /** Unwrapped heading so turns animate the short/expected way (may exceed 360). */
  readonly headingDeg: number;
  /** Height above the floor in cm: 0 on the ground. */
  readonly altitudeCm: number;
}

/** A point of the flight trail, at the height the drone flew it. */
export interface TrailPoint extends Point {
  readonly altitudeCm: number;
}

export interface TimelineSegment {
  readonly stepIndex: number;
  readonly start: number;
  readonly end: number;
  readonly from: Pose;
  readonly to: Pose;
  readonly failed: boolean;
}

export interface Timeline {
  readonly initialPose: Pose;
  readonly segments: readonly TimelineSegment[];
  readonly totalSeconds: number;
}

/** Nominal 1× playback speeds (not real CoDrone performance figures). */
export const PLAYBACK = {
  moveCmPerSecond: 40,
  turnDegPerSecond: 75,
  verticalCmPerSecond: 30,
  takeoffSeconds: 1.2,
  landSeconds: 1.2,
  rejectedSeconds: 0.8,
  minSeconds: 0.35,
} as const;

/** The drone sitting on its start mark. */
export function restingPose(maze: MazeDefinition): Pose {
  return { x: maze.start.x, y: maze.start.y, headingDeg: maze.startHeadingDeg, altitudeCm: 0 };
}

export function buildTimeline(result: SimulationResult, maze: MazeDefinition): Timeline {
  const initialPose = restingPose(maze);
  const segments: TimelineSegment[] = [];
  let pose = initialPose;
  let time = 0;

  for (const step of result.steps) {
    const { command, failure } = step;
    let to: Pose = pose;
    let duration: number = PLAYBACK.rejectedSeconds;

    if (failure) {
      // Show the drone moving until it touches the hazard, then stop.
      const contact = failure.contactPoint;
      if (contact && command.type === 'MOVE') {
        const travelled = Math.hypot(contact.x - pose.x, contact.y - pose.y);
        to = { ...pose, x: contact.x, y: contact.y };
        duration = Math.max(PLAYBACK.minSeconds, travelled / PLAYBACK.moveCmPerSecond);
      }
    } else {
      switch (command.type) {
        case 'TAKEOFF':
          to = { ...pose, altitudeCm: step.after.heightCm };
          duration = PLAYBACK.takeoffSeconds;
          break;
        case 'LAND':
          to = { ...pose, altitudeCm: 0 };
          duration = PLAYBACK.landSeconds;
          break;
        case 'VERTICAL':
          to = { ...pose, altitudeCm: step.after.heightCm };
          duration = Math.max(PLAYBACK.minSeconds, command.distanceCm / PLAYBACK.verticalCmPerSecond);
          break;
        case 'HOVER':
          duration = Math.max(PLAYBACK.minSeconds, command.durationSeconds);
          break;
        case 'TURN': {
          const delta = command.direction === 'RIGHT' ? command.degrees : -command.degrees;
          to = { ...pose, headingDeg: pose.headingDeg + delta };
          duration = Math.max(PLAYBACK.minSeconds, command.degrees / PLAYBACK.turnDegPerSecond);
          break;
        }
        case 'MOVE':
          to = { ...pose, x: step.after.x, y: step.after.y };
          duration = Math.max(PLAYBACK.minSeconds, command.distanceCm / PLAYBACK.moveCmPerSecond);
          break;
      }
    }

    segments.push({ stepIndex: step.index, start: time, end: time + duration, from: pose, to, failed: failure !== null });
    time += duration;
    pose = to;
  }

  return { initialPose, segments, totalSeconds: time };
}

/**
 * Smootherstep: velocity *and* acceleration are zero at both ends, like a real
 * multirotor easing in and out of a move. Keeps the 3D tilt continuous.
 */
const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export interface PlaybackFrame {
  readonly pose: Pose;
  /** Segment being played, or null before the first / with no program. */
  readonly activeStepIndex: number | null;
  /** Number of steps fully played. */
  readonly completedSteps: number;
}

export function frameAt(timeline: Timeline, seconds: number): PlaybackFrame {
  const { segments } = timeline;
  if (segments.length === 0) return { pose: timeline.initialPose, activeStepIndex: null, completedSteps: 0 };

  let completed = 0;
  for (const segment of segments) {
    if (seconds >= segment.end) {
      completed++;
      continue;
    }
    const span = segment.end - segment.start;
    const t = span <= 0 ? 1 : ease(Math.max(0, (seconds - segment.start) / span));
    const { from, to } = segment;
    return {
      pose: {
        x: mix(from.x, to.x, t),
        y: mix(from.y, to.y, t),
        headingDeg: mix(from.headingDeg, to.headingDeg, t),
        altitudeCm: mix(from.altitudeCm, to.altitudeCm, t),
      },
      activeStepIndex: segment.stepIndex,
      completedSteps: completed,
    };
  }

  const last = segments[segments.length - 1];
  return { pose: last ? last.to : timeline.initialPose, activeStepIndex: null, completedSteps: completed };
}

const trailPoint = (p: Pose): TrailPoint => ({ x: p.x, y: p.y, altitudeCm: p.altitudeCm });

/**
 * Points the drone has flown through up to `seconds`, for drawing a trail. It starts once
 * the drone has climbed to flight height and includes up/down moves; take off and landing
 * are left out, so the trail shows the moves in the program.
 */
export function trailAt(timeline: Timeline, seconds: number): TrailPoint[] {
  const points: TrailPoint[] = [];
  for (const segment of timeline.segments) {
    if (seconds <= segment.start) break;
    const { from, to } = segment;
    const finished = seconds >= segment.end;
    if (from.altitudeCm <= 0) {
      // Taking off: the trail begins where the climb ends.
      if (finished && to.altitudeCm > 0) points.push(trailPoint(to));
      continue;
    }
    if (to.altitudeCm <= 0) continue; // landing
    if (from.x === to.x && from.y === to.y && from.altitudeCm === to.altitudeCm) continue;
    if (points.length === 0) points.push(trailPoint(from));
    points.push(trailPoint(finished ? to : frameAt(timeline, seconds).pose));
  }
  return points;
}
