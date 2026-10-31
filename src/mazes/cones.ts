import type { MazeDefinition, Point } from './types';

/**
 * Traffic cones on a real course: one on every checkpoint, and one just inside
 * each arena corner. The 3D classroom draws the same cones. They are markers to
 * fly over (they're about 30 cm tall, well under flight height), but not a safe
 * place to land: a drone coming down on one tips over or breaks a propeller.
 */
export const CONE_BASE_CM = 18;
export const ARENA_CONE_INSET_CM = 6;

export interface Cone extends Point {
  readonly label: string;
}

export function conesOf(maze: MazeDefinition): Cone[] {
  const i = ARENA_CONE_INSET_CM;
  const corners: Cone[] = [
    { x: i, y: i },
    { x: maze.widthCm - i, y: i },
    { x: i, y: maze.heightCm - i },
    { x: maze.widthCm - i, y: maze.heightCm - i },
  ].map((p) => ({ ...p, label: 'arena corner cone' }));
  return [...maze.checkpoints.map((cp) => ({ x: cp.x, y: cp.y, label: cp.label })), ...corners];
}

/** The square footprint of a cone's base. */
export const coneBase = (cone: Point) => ({
  x: cone.x - CONE_BASE_CM / 2,
  y: cone.y - CONE_BASE_CM / 2,
  width: CONE_BASE_CM,
  height: CONE_BASE_CM,
});
