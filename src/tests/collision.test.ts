import { describe, expect, it } from 'vitest';
import {
  checkPath,
  firstContactT,
  segmentIntersectsRect,
  segmentRectDistance,
  sweptCircleHitsRect,
} from '../engine/CollisionDetector';
import type { MazeDefinition } from '../mazes/types';

const wall = { x: 100, y: 0, width: 2, height: 200 };

function maze(overrides: Partial<MazeDefinition> = {}): MazeDefinition {
  return {
    id: 'test',
    name: 'Test',
    description: '',
    widthCm: 400,
    heightCm: 300,
    start: { x: 50, y: 250 },
    startHeadingDeg: 0,
    landingZone: { x: 0, y: 0, width: 50, height: 50 },
    obstacles: [],
    noFlyZones: [],
    checkpoints: [],
    droneRadiusCm: 5,
    gridSpacingCm: 25,
    ...overrides,
  };
}

describe('segment / rectangle geometry', () => {
  it('detects a segment crossing a thin wall', () => {
    expect(segmentIntersectsRect({ x: 50, y: 100 }, { x: 150, y: 100 }, wall)).toBe(true);
    expect(segmentRectDistance({ x: 50, y: 100 }, { x: 150, y: 100 }, wall)).toBe(0);
  });

  it('measures distance from a parallel segment', () => {
    expect(segmentRectDistance({ x: 90, y: 0 }, { x: 90, y: 300 }, wall)).toBe(10);
  });

  it('measures distance around a corner', () => {
    // Passes 3 cm right and 4 cm below the wall's bottom-right corner (102, 200).
    expect(segmentRectDistance({ x: 0, y: 204 }, { x: 105, y: 204 }, wall)).toBe(4);
    expect(segmentRectDistance({ x: 105, y: 204 }, { x: 105, y: 204 }, wall)).toBe(5);
  });
});

describe('swept circle collisions', () => {
  it('does not tunnel through a 2 cm wall on a long jump', () => {
    // Both endpoints are far from the wall; only a swept test catches this.
    expect(sweptCircleHitsRect({ x: 10, y: 100 }, { x: 390, y: 100 }, 5, wall)).toBe(true);
  });

  it('allows a path that passes exactly at radius distance (touching)', () => {
    expect(sweptCircleHitsRect({ x: 95, y: 250 }, { x: 95, y: 0 }, 5, wall)).toBe(false);
    expect(sweptCircleHitsRect({ x: 95.1, y: 250 }, { x: 95.1, y: 0 }, 5, wall)).toBe(true);
  });

  it('catches clipping a corner with the drone body', () => {
    expect(sweptCircleHitsRect({ x: 0, y: 203 }, { x: 200, y: 203 }, 5, wall)).toBe(true);
    expect(sweptCircleHitsRect({ x: 0, y: 206 }, { x: 200, y: 206 }, 5, wall)).toBe(false);
  });

  it('finds the first contact point along the path', () => {
    const t = firstContactT({ x: 0, y: 100 }, { x: 200, y: 100 }, 5, wall);
    // The drone's edge touches x = 100 when its centre is at x = 95.
    expect(t * 200).toBeCloseTo(95, 6);
  });
});

describe('checkPath', () => {
  it('reports obstacles with their id', () => {
    const m = maze({ obstacles: [{ id: 'w', label: 'Wall', ...wall }] });
    expect(checkPath(m, { x: 50, y: 100 }, { x: 200, y: 100 })).toMatchObject({ kind: 'COLLISION_OBSTACLE', zoneId: 'w' });
  });

  it('reports entering a no-fly zone', () => {
    const m = maze({ noFlyZones: [{ id: 'red', label: 'Red', x: 200, y: 200, width: 50, height: 50 }] });
    expect(checkPath(m, { x: 150, y: 225 }, { x: 300, y: 225 })).toMatchObject({ kind: 'NO_FLY_ZONE', zoneId: 'red' });
    expect(checkPath(m, { x: 150, y: 100 }, { x: 300, y: 100 })).toBeNull();
  });

  it('reports leaving the arena, accounting for the drone radius', () => {
    const m = maze();
    expect(checkPath(m, { x: 50, y: 50 }, { x: 50, y: 5 })).toBeNull();
    expect(checkPath(m, { x: 50, y: 50 }, { x: 50, y: 4 })).toMatchObject({ kind: 'OUT_OF_BOUNDS' });
    const exit = checkPath(m, { x: 300, y: 100 }, { x: 500, y: 100 });
    expect(exit?.contactPoint).toEqual({ x: 395, y: 100 });
  });

  it('returns the earliest hazard when several are on the path', () => {
    const m = maze({
      obstacles: [{ id: 'far', label: 'Far', x: 300, y: 0, width: 10, height: 300 }],
      noFlyZones: [{ id: 'near', label: 'Near', x: 150, y: 0, width: 10, height: 300 }],
    });
    expect(checkPath(m, { x: 50, y: 100 }, { x: 390, y: 100 })?.zoneId).toBe('near');
  });
});
