/**
 * Pure kinematics: where a command would put the drone, ignoring obstacles.
 */
import type { MoveDirection, TurnDirection } from '../parser/types';
import type { Point } from '../mazes/types';

/** Rounds away floating-point noise (e.g. cos(90°) ≈ 6e-17) to keep results stable. */
export function cleanNumber(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function normalizeHeading(degrees: number): number {
  const normalized = ((degrees % 360) + 360) % 360;
  return cleanNumber(normalized === 360 ? 0 : normalized);
}

const DIRECTION_OFFSET: Readonly<Record<MoveDirection, number>> = {
  FORWARD: 0,
  RIGHT: 90,
  BACKWARD: 180,
  LEFT: 270,
};

const CARDINAL_VECTORS: readonly Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/** Unit vector for a heading. 0° → (0, -1) (up), 90° → (1, 0) (right). */
export function headingVector(headingDeg: number): Point {
  const heading = normalizeHeading(headingDeg);
  // Exact vectors for the common cases avoid trig noise entirely.
  const cardinal = heading % 90 === 0 ? CARDINAL_VECTORS[heading / 90] : undefined;
  if (cardinal) return cardinal;
  const rad = (heading * Math.PI) / 180;
  return { x: Math.sin(rad), y: -Math.cos(rad) };
}

/** Target point of a heading-relative move. */
export function moveTarget(from: Point, headingDeg: number, direction: MoveDirection, distanceCm: number): Point {
  const v = headingVector(headingDeg + DIRECTION_OFFSET[direction]);
  return { x: cleanNumber(from.x + v.x * distanceCm), y: cleanNumber(from.y + v.y * distanceCm) };
}

/** Right turns are clockwise (heading increases); left turns are anticlockwise. */
export function turnHeading(headingDeg: number, direction: TurnDirection, degrees: number): number {
  return normalizeHeading(headingDeg + (direction === 'RIGHT' ? degrees : -degrees));
}
