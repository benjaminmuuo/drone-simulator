/**
 * Visual-only flight dynamics for the 3D view. Nothing here feeds back into
 * the simulation: it only decides how the drone *looks* while following the
 * authoritative timeline.
 */
import { frameAt } from '../animation/timeline';
import type { Timeline } from '../animation/timeline';
import { headingVector } from '../engine/MovementEngine';
import type { Point } from '../mazes/types';

/** Degrees of tilt per cm/s² of horizontal acceleration. */
export const TILT_PER_ACCEL = 0.07;
export const MAX_TILT_DEG = 20;
/** Gravity in cm/s², for the crash fall. */
export const GRAVITY_CM_S2 = 981;

export interface Attitude {
  /** Positive = nose down (accelerating forward). */
  readonly pitchDeg: number;
  /** Positive = right side down (accelerating right). */
  readonly rollDeg: number;
}

const LEVEL: Attitude = { pitchDeg: 0, rollDeg: 0 };
// `+ 0` turns -0 into 0 so level flight compares equal to LEVEL.
const clampTilt = (deg: number) => Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, deg)) + 0;

function positionAt(timeline: Timeline, seconds: number): Point {
  const t = Math.max(0, Math.min(timeline.totalSeconds, seconds));
  const { pose } = frameAt(timeline, t);
  return { x: pose.x, y: pose.y };
}

/** Horizontal acceleration (cm/s², arena axes) by central differences of the timeline. */
export function accelerationAt(timeline: Timeline, seconds: number, h = 1 / 120): Point {
  const prev = positionAt(timeline, seconds - h);
  const here = positionAt(timeline, seconds);
  const next = positionAt(timeline, seconds + h);
  return {
    x: (next.x - 2 * here.x + prev.x) / (h * h),
    y: (next.y - 2 * here.y + prev.y) / (h * h),
  };
}

/** A multirotor tilts into its acceleration: forward accel → nose down, etc. */
export function attitudeFromAcceleration(accel: Point, headingDeg: number): Attitude {
  const forward = headingVector(headingDeg);
  const right = headingVector(headingDeg + 90);
  const forwardAccel = accel.x * forward.x + accel.y * forward.y;
  const rightAccel = accel.x * right.x + accel.y * right.y;
  return {
    pitchDeg: clampTilt(forwardAccel * TILT_PER_ACCEL),
    rollDeg: clampTilt(rightAccel * TILT_PER_ACCEL),
  };
}

export function attitudeAt(timeline: Timeline, seconds: number): Attitude {
  if (timeline.segments.length === 0) return LEVEL;
  const { pose } = frameAt(timeline, seconds);
  return attitudeFromAcceleration(accelerationAt(timeline, seconds), pose.headingDeg);
}

export interface HoverWobble {
  readonly dyCm: number;
  readonly pitchDeg: number;
  readonly rollDeg: number;
}

/**
 * Gentle, deterministic bobbing of a hovering drone (a few mm and a fraction
 * of a degree), using incommensurate frequencies so it never looks looped.
 */
export function hoverWobble(seconds: number, strength: number): HoverWobble {
  const s = Math.max(0, Math.min(1, strength));
  if (s === 0) return { dyCm: 0, pitchDeg: 0, rollDeg: 0 };
  const tau = Math.PI * 2;
  return {
    dyCm: s * (0.9 * Math.sin(tau * 0.55 * seconds) + 0.35 * Math.sin(tau * 1.37 * seconds + 1.1)),
    pitchDeg: s * 0.6 * Math.sin(tau * 0.83 * seconds + 0.4),
    rollDeg: s * 0.6 * Math.sin(tau * 0.71 * seconds + 2.3),
  };
}

/** Height and tumble of a drone falling after a collision. */
export function crashFall(startAltitudeCm: number, secondsSinceCrash: number): { altitudeCm: number; tiltDeg: number } {
  const t = Math.max(0, secondsSinceCrash);
  const altitudeCm = Math.max(0, startAltitudeCm - 0.5 * GRAVITY_CM_S2 * t * t);
  const fallTime = Math.sqrt((2 * startAltitudeCm) / GRAVITY_CM_S2);
  const progress = fallTime === 0 ? 1 : Math.min(1, t / fallTime);
  return { altitudeCm, tiltDeg: 28 * progress };
}
