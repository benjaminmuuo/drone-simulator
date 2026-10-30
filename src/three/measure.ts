/**
 * Measuring tool maths, in arena centimetres measured from the taped "0,0"
 * corner, so students can lay out the real course with a tape measure.
 */
import { DEFAULT_OBSTACLE_HEIGHT_CM } from '../mazes/constants';
import type { MazeDefinition, Rect } from '../mazes/types';

export interface MeasurePoint {
  /** Distance from the 0,0 corner along the arena's width. */
  readonly x: number;
  /** Distance from the 0,0 corner along the arena's depth. */
  readonly y: number;
  /** Height above the floor. */
  readonly heightCm: number;
}

export interface SnappedPoint {
  readonly point: MeasurePoint;
  /** What the point snapped to, e.g. "corner of Box wall"; null if free. */
  readonly label: string | null;
}

export interface Measurement {
  readonly a: SnappedPoint;
  readonly b: SnappedPoint;
  /** Straight-line distance. */
  readonly distanceCm: number;
  /** Difference along the width (x). */
  readonly acrossCm: number;
  /** Difference along the depth (y). */
  readonly alongCm: number;
  /** Difference in height. */
  readonly upCm: number;
}

/** Clicks within this distance of a key point snap onto it. */
export const SNAP_RADIUS_CM = 6;
/** On screen, a key point this many pixels from the pointer is "under" it. */
export const SNAP_RADIUS_PX = 18;

export interface KeyPoint {
  readonly point: MeasurePoint;
  readonly label: string;
}

function rectCorners(r: Rect, heightCm: number, label: string): KeyPoint[] {
  return [
    [r.x, r.y],
    [r.x + r.width, r.y],
    [r.x, r.y + r.height],
    [r.x + r.width, r.y + r.height],
  ].map(([x, y]) => ({ point: { x: x!, y: y!, heightCm }, label }));
}

/** Points worth measuring between: corners, pad centres, cones, the start mark. */
export function keyPoints(maze: MazeDefinition): KeyPoint[] {
  const points: KeyPoint[] = [
    ...rectCorners({ x: 0, y: 0, width: maze.widthCm, height: maze.heightCm }, 0, 'arena corner'),
    { point: { ...maze.start, heightCm: 0 }, label: 'start mark' },
    ...rectCorners(maze.landingZone, 0, 'landing pad corner'),
    {
      point: { x: maze.landingZone.x + maze.landingZone.width / 2, y: maze.landingZone.y + maze.landingZone.height / 2, heightCm: 0 },
      label: 'landing pad centre',
    },
  ];
  for (const o of maze.obstacles) {
    points.push(...rectCorners(o, 0, `corner of ${o.label}`));
    points.push(...rectCorners(o, o.heightCm ?? DEFAULT_OBSTACLE_HEIGHT_CM, `top corner of ${o.label}`));
  }
  for (const z of maze.noFlyZones) points.push(...rectCorners(z, 0, `corner of ${z.label}`));
  for (const cp of maze.checkpoints) points.push({ point: { x: cp.x, y: cp.y, heightCm: 0 }, label: cp.label });
  return points;
}

const round = (n: number) => Math.round(n) + 0;

/** Snaps to the nearest key point within reach, otherwise rounds to whole cm. */
export function snapPoint(maze: MazeDefinition, p: MeasurePoint): SnappedPoint {
  let best: KeyPoint | null = null;
  let bestDistance = SNAP_RADIUS_CM;
  for (const key of keyPoints(maze)) {
    const d = Math.hypot(key.point.x - p.x, key.point.y - p.y, key.point.heightCm - p.heightCm);
    if (d <= bestDistance) {
      best = key;
      bestDistance = d;
    }
  }
  if (best) return { point: best.point, label: best.label };
  return freePoint(p);
}

/** A point that did not snap: rounded to whole centimetres, never below the floor. */
export function freePoint(p: MeasurePoint): SnappedPoint {
  return { point: { x: round(p.x), y: round(p.y), heightCm: round(Math.max(0, p.heightCm)) }, label: null };
}

export interface SnapCandidate {
  readonly key: KeyPoint;
  /** Pixels between the pointer and the key point on screen. */
  readonly screenDistance: number;
}

/**
 * Picks the key point the student is pointing at. Snapping works in screen
 * pixels, so it is equally easy close up and far away. When the pointer is
 * on a surface, points at that surface's height win (a box top beats the
 * floor corner right below it, and the other way round).
 */
export function chooseSnap(candidates: readonly SnapCandidate[], hitHeightCm: number | null, radiusPx = SNAP_RADIUS_PX): KeyPoint | null {
  let best: KeyPoint | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const { key, screenDistance } of candidates) {
    if (screenDistance > radiusPx) continue;
    const otherLevel = hitHeightCm !== null && Math.abs(key.point.heightCm - hitHeightCm) > 5;
    const score = screenDistance + (otherLevel ? radiusPx : 0);
    if (score < bestScore) {
      best = key;
      bestScore = score;
    }
  }
  return best;
}

export function measureBetween(a: SnappedPoint, b: SnappedPoint): Measurement {
  const dx = b.point.x - a.point.x;
  const dy = b.point.y - a.point.y;
  const dh = b.point.heightCm - a.point.heightCm;
  return {
    a,
    b,
    distanceCm: round(Math.hypot(dx, dy, dh)),
    acrossCm: round(Math.abs(dx)),
    alongCm: round(Math.abs(dy)),
    upCm: round(Math.abs(dh)),
  };
}

/** "x 50, y 250" (plus height when above the floor). */
export function formatPoint(p: MeasurePoint): string {
  return `x ${round(p.x)}, y ${round(p.y)}${p.heightCm > 0 ? `, ${round(p.heightCm)} cm up` : ''}`;
}
