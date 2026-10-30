/**
 * Continuous (swept) collision detection for a circular drone moving in a
 * straight line through axis-aligned rectangles.
 *
 * Because a straight path and a rectangle are both convex, the drone touches a
 * rectangle somewhere along the path iff the distance between the segment and
 * the rectangle is less than the drone radius — this is exact, so the drone
 * can never "tunnel" through a thin wall regardless of the distance moved.
 */
import { DEFAULT_FLIGHT_HEIGHT_CM, DEFAULT_OBSTACLE_HEIGHT_CM, OBSTACLE_CLEARANCE_CM } from '../mazes/constants';
import type { MazeDefinition, Obstacle, Point, Rect } from '../mazes/types';
import type { FailureKind } from './types';

/** Touching an obstacle exactly is allowed; overlapping by more than this is not. */
const EPSILON = 1e-9;

export function rectContainsPoint(rect: Rect, p: Point): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
}

export function pointRectDistance(p: Point, rect: Rect): number {
  const dx = Math.max(rect.x - p.x, 0, p.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - p.y, 0, p.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

/** Liang–Barsky clip: does segment a→b touch the (closed) rectangle? */
export function segmentIntersectsRect(a: Point, b: Point, rect: Rect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: Array<[number, number]> = [
    [-dx, a.x - rect.x],
    [dx, rect.x + rect.width - a.x],
    [-dy, a.y - rect.y],
    [dy, rect.y + rect.height - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

export function segmentRectDistance(a: Point, b: Point, rect: Rect): number {
  if (segmentIntersectsRect(a, b, rect)) return 0;
  const corners: Point[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ];
  return Math.min(
    pointRectDistance(a, rect),
    pointRectDistance(b, rect),
    ...corners.map((c) => pointSegmentDistance(c, a, b)),
  );
}

export function circleOverlapsRect(center: Point, radius: number, rect: Rect): boolean {
  return pointRectDistance(center, rect) < radius - EPSILON;
}

export function sweptCircleHitsRect(a: Point, b: Point, radius: number, rect: Rect): boolean {
  return segmentRectDistance(a, b, rect) < radius - EPSILON;
}

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/**
 * Fraction t ∈ [0, 1] of the path at which the drone first touches the rect.
 * Distance-to-rect along a line is convex in t, so we ternary-search its
 * minimum and then bisect for the first crossing of the radius.
 */
export function firstContactT(a: Point, b: Point, radius: number, rect: Rect): number {
  const f = (t: number) => pointRectDistance(lerp(a, b, t), rect);
  if (f(0) < radius) return 0;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (f(m1) <= f(m2)) hi = m2;
    else lo = m1;
  }
  let inside = (lo + hi) / 2;
  let outside = 0;
  for (let i = 0; i < 60; i++) {
    const mid = (inside + outside) / 2;
    if (f(mid) < radius) inside = mid;
    else outside = mid;
  }
  return outside;
}

/** Fraction of the path at which the drone's edge leaves the arena, or null. */
function boundaryExitT(a: Point, b: Point, radius: number, maze: MazeDefinition): number | null {
  const axes: Array<[from: number, to: number, size: number]> = [
    [a.x, b.x, maze.widthCm],
    [a.y, b.y, maze.heightCm],
  ];
  let earliest: number | null = null;
  for (const [from, to, size] of axes) {
    const min = radius;
    const max = size - radius;
    let t: number | null = null;
    if (to < min - EPSILON) t = (min - from) / (to - from);
    else if (to > max + EPSILON) t = (max - from) / (to - from);
    if (t !== null) earliest = Math.min(earliest ?? 1, Math.max(0, t));
  }
  return earliest;
}

export interface PathCollision {
  readonly kind: Extract<FailureKind, 'COLLISION_OBSTACLE' | 'NO_FLY_ZONE' | 'OUT_OF_BOUNDS'>;
  readonly zoneId?: string;
  readonly zoneLabel?: string;
  readonly t: number;
  readonly contactPoint: Point;
}

/** True if the drone, flying at `flightHeightCm`, cannot pass over this obstacle. */
export function blocksFlight(obstacle: Obstacle, flightHeightCm: number): boolean {
  return (obstacle.heightCm ?? DEFAULT_OBSTACLE_HEIGHT_CM) > flightHeightCm - OBSTACLE_CLEARANCE_CM;
}

/**
 * Checks a straight move against every hazard; returns the earliest hit or
 * null. Obstacles low enough to fly over are ignored; no-fly zones always count.
 */
export function checkPath(
  maze: MazeDefinition,
  a: Point,
  b: Point,
  flightHeightCm: number = DEFAULT_FLIGHT_HEIGHT_CM,
): PathCollision | null {
  const r = maze.droneRadiusCm;
  const hits: PathCollision[] = [];

  const exitT = boundaryExitT(a, b, r, maze);
  if (exitT !== null) hits.push({ kind: 'OUT_OF_BOUNDS', t: exitT, contactPoint: lerp(a, b, exitT) });

  for (const obstacle of maze.obstacles) {
    if (blocksFlight(obstacle, flightHeightCm) && sweptCircleHitsRect(a, b, r, obstacle)) {
      const t = firstContactT(a, b, r, obstacle);
      hits.push({ kind: 'COLLISION_OBSTACLE', zoneId: obstacle.id, zoneLabel: obstacle.label, t, contactPoint: lerp(a, b, t) });
    }
  }
  for (const zone of maze.noFlyZones) {
    if (sweptCircleHitsRect(a, b, r, zone)) {
      const t = firstContactT(a, b, r, zone);
      hits.push({ kind: 'NO_FLY_ZONE', zoneId: zone.id, zoneLabel: zone.label, t, contactPoint: lerp(a, b, t) });
    }
  }

  if (hits.length === 0) return null;
  return hits.reduce((first, hit) => (hit.t < first.t ? hit : first));
}
