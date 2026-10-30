/**
 * Arena (2D, cm, +y down) ↔ three.js world (cm, +y up) mapping.
 * The arena is centred on the world origin; arena +y maps to world +z.
 */
import type { MazeDefinition } from '../mazes/types';

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function arenaToWorld(maze: MazeDefinition, x: number, y: number, altitudeCm = 0): WorldPoint {
  return { x: x - maze.widthCm / 2, y: altitudeCm, z: y - maze.heightCm / 2 };
}

/**
 * Heading (0° = arena up = world −z, clockwise seen from above) to a
 * rotation about world +y (counter-clockwise seen from above).
 */
export function headingToYaw(headingDeg: number): number {
  return (-headingDeg * Math.PI) / 180;
}

/** Deterministic PRNG so the scenery is identical on every load. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
