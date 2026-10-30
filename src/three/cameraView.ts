/**
 * Camera helpers: game-style smoothing, and keeping the follow camera's view
 * of the drone clear. The camera may slide closer to the drone along its line
 * of sight, but never changes its angle.
 */
import { DEFAULT_OBSTACLE_HEIGHT_CM } from '../mazes/constants';
import type { MazeDefinition } from '../mazes/types';
import { arenaToWorld } from './coords';
import type { CameraBounds } from './scenery';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Gap kept between the camera and an obstacle face. */
export const CAMERA_CLEARANCE_CM = 10;

/**
 * Critically damped spring (as used by game cameras): moves `current` towards
 * `target`, arriving in roughly `smoothTime` seconds without overshooting.
 * `velocity` is carried between frames and updated in place.
 */
export function smoothDamp(current: number, target: number, velocity: { v: number }, smoothTime: number, dt: number): number {
  const omega = 2 / Math.max(1e-4, smoothTime);
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (velocity.v + omega * change) * dt;
  velocity.v = (velocity.v - omega * temp) * decay;
  let next = target + (change + temp) * decay;
  // Never overshoot the target.
  if (target - current > 0 === next > target) {
    next = target;
    velocity.v = 0;
  }
  return next;
}

/**
 * Entry fraction (0..1) of the segment from + t·delta into an axis-aligned
 * box, or null if the segment misses it. Starting inside counts as a miss, so
 * a drone touching a wall never pulls the camera onto itself.
 */
function segmentEntersBox(from: Vec3, delta: Vec3, min: Vec3, max: Vec3): number | null {
  let tEnter = 0;
  let tExit = 1;
  let inside = true;
  for (const axis of ['x', 'y', 'z'] as const) {
    const o = from[axis];
    const d = delta[axis];
    if (o < min[axis] || o > max[axis]) inside = false;
    if (d === 0) {
      if (o < min[axis] || o > max[axis]) return null;
      continue;
    }
    let t1 = (min[axis] - o) / d;
    let t2 = (max[axis] - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tEnter = Math.max(tEnter, t1);
    tExit = Math.min(tExit, t2);
    if (tEnter > tExit) return null;
  }
  return inside ? null : tEnter;
}

/** The safety-net cage around the arena (forest theme). */
export function arenaBounds(maze: MazeDefinition, clearance = CAMERA_CLEARANCE_CM): CameraBounds {
  return {
    minX: -maze.widthCm / 2 + clearance,
    maxX: maze.widthCm / 2 - clearance,
    minZ: -maze.heightCm / 2 + clearance,
    maxZ: maze.heightCm / 2 - clearance,
    maxY: Number.POSITIVE_INFINITY,
  };
}

/**
 * How much of `offset` (camera minus target, world cm) can be used before the
 * camera would leave `bounds` or have an obstacle between it and the target.
 * Returns a factor in (0, 1].
 */
export function clearViewScale(
  maze: MazeDefinition,
  target: Vec3,
  offset: Vec3,
  bounds: CameraBounds = arenaBounds(maze),
): number {
  let scale = 1;
  const limit = (from: number, delta: number, min: number, max: number) => {
    if (delta > 0 && from < max) scale = Math.min(scale, (max - from) / delta);
    if (delta < 0 && from > min) scale = Math.min(scale, (min - from) / delta);
  };
  limit(target.x, offset.x, bounds.minX, bounds.maxX);
  limit(target.z, offset.z, bounds.minZ, bounds.maxZ);
  limit(target.y, offset.y, Number.NEGATIVE_INFINITY, bounds.maxY);

  // Stop in front of any box or wall that would hide the drone.
  const c = CAMERA_CLEARANCE_CM;
  for (const o of maze.obstacles) {
    const a = arenaToWorld(maze, o.x - c, o.y - c, 0);
    const b = arenaToWorld(maze, o.x + o.width + c, o.y + o.height + c, (o.heightCm ?? DEFAULT_OBSTACLE_HEIGHT_CM) + c);
    const t = segmentEntersBox(target, offset, a, b);
    if (t !== null) scale = Math.min(scale, t);
  }
  return Math.max(1e-3, scale);
}

/** Pulls a point back inside `bounds` (used for the free overview camera indoors). */
export function clampToBounds(p: { x: number; y: number; z: number }, bounds: CameraBounds, minY = 8): void {
  p.x = Math.min(bounds.maxX, Math.max(bounds.minX, p.x));
  p.z = Math.min(bounds.maxZ, Math.max(bounds.minZ, p.z));
  p.y = Math.min(bounds.maxY, Math.max(minY, p.y));
}
