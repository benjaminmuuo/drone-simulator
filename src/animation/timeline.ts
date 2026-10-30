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
  /** 0 = on the ground, 1 = flying. Visual only. */
  readonly altitude: number;
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
  takeoffSeconds: 1.2,
  landSeconds: 1.2,
  rejectedSeconds: 0.8,
  minSeconds: 0.35,
} as const;

export function buildTimeline(result: SimulationResult, maze: MazeDefinition): Timeline {
  const initialPose: Pose = { x: maze.start.x, y: maze.start.y, headingDeg: maze.startHeadingDeg, altitude: 0 };
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
          to = { ...pose, altitude: 1 };
          duration = PLAYBACK.takeoffSeconds;
          break;
        case 'LAND':
          to = { ...pose, altitude: 0 };
          duration = PLAYBACK.landSeconds;
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
        altitude: mix(from.altitude, to.altitude, t),
      },
      activeStepIndex: segment.stepIndex,
      completedSteps: completed,
    };
  }

  const last = segments[segments.length - 1];
  return { pose: last ? last.to : timeline.initialPose, activeStepIndex: null, completedSteps: completed };
}

/** Points the drone has flown through up to `seconds`, for drawing a trail. */
export function trailAt(timeline: Timeline, seconds: number): Point[] {
  const points: Point[] = [{ x: timeline.initialPose.x, y: timeline.initialPose.y }];
  for (const segment of timeline.segments) {
    if (seconds <= segment.start) break;
    if (segment.from.x === segment.to.x && segment.from.y === segment.to.y) continue;
    const end = seconds >= segment.end ? segment.to : frameAt(timeline, seconds).pose;
    points.push({ x: end.x, y: end.y });
  }
  return points;
}
