import { describe, expect, it } from 'vitest';
import { buildTimeline, frameAt } from '../animation/timeline';
import { simulate } from '../engine/SimulationEngine';
import { beginnerMaze } from '../mazes/beginner-maze';
import { DEFAULT_FLIGHT_HEIGHT_CM } from '../mazes/constants';
import { openField } from '../mazes/open-field';
import type { DroneCommand } from '../parser/types';
import { CAMERA_CLEARANCE_CM, clampToBounds, clearViewScale, smoothDamp } from '../three/cameraView';
import { SNAP_RADIUS_PX, chooseSnap, formatPoint, freePoint, keyPoints, measureBetween, snapPoint } from '../three/measure';
import { arenaToWorld, headingToYaw, seededRandom } from '../three/coords';
import {
  MAX_TILT_DEG,
  attitudeAt,
  attitudeFromAcceleration,
  crashFall,
  hoverWobble,
} from '../three/motion';

const program: DroneCommand[] = [
  { type: 'TAKEOFF', blockId: 'a' },
  { type: 'MOVE', direction: 'FORWARD', distanceCm: 80, blockId: 'b' },
  { type: 'TURN', direction: 'RIGHT', degrees: 90, blockId: 'c' },
  { type: 'MOVE', direction: 'LEFT', distanceCm: 40, blockId: 'd' },
  { type: 'LAND', blockId: 'e' },
];
const timeline = buildTimeline(simulate(program, openField), openField);
const seg = (i: number) => timeline.segments[i]!;
const at = (i: number, fraction: number) => seg(i).start + (seg(i).end - seg(i).start) * fraction;

describe('3D coordinate mapping', () => {
  it('centres the arena and maps arena y to world z', () => {
    expect(arenaToWorld(openField, 0, 0)).toEqual({ x: -200, y: 0, z: -150 });
    expect(arenaToWorld(openField, 400, 300, 80)).toEqual({ x: 200, y: 80, z: 150 });
  });

  it('turns clockwise headings into counter-clockwise yaw', () => {
    // Rotating the model's nose (0,0,-1) by yaw: heading 90° must face world +x.
    const yaw = headingToYaw(90);
    expect(-Math.sin(yaw)).toBeCloseTo(1, 10);
    expect(-Math.cos(yaw)).toBeCloseTo(0, 10);
  });

  it('seeded scenery is reproducible', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('visual flight dynamics', () => {
  it('pitches nose-down when speeding up and nose-up when braking', () => {
    expect(attitudeAt(timeline, at(1, 0.2)).pitchDeg).toBeGreaterThan(3);
    expect(attitudeAt(timeline, at(1, 0.8)).pitchDeg).toBeLessThan(-3);
    expect(Math.abs(attitudeAt(timeline, at(1, 0.2)).rollDeg)).toBeLessThan(0.01);
  });

  it('rolls (not pitches) when strafing sideways', () => {
    const start = attitudeAt(timeline, at(3, 0.2));
    expect(start.rollDeg).toBeLessThan(-3); // accelerating left → left side down
    expect(Math.abs(start.pitchDeg)).toBeLessThan(0.01);
  });

  it('is level while hovering, turning in place, or idle', () => {
    expect(attitudeAt(timeline, at(2, 0.5))).toEqual({ pitchDeg: 0, rollDeg: 0 });
    expect(attitudeAt(buildTimeline(simulate([], openField), openField), 0)).toEqual({ pitchDeg: 0, rollDeg: 0 });
  });

  it('starts and ends each move without a jolt (smootherstep easing)', () => {
    expect(Math.abs(attitudeAt(timeline, seg(1).start + 1e-3).pitchDeg)).toBeLessThan(0.5);
    expect(Math.abs(attitudeAt(timeline, seg(1).end - 1e-3).pitchDeg)).toBeLessThan(0.5);
  });

  it('never tilts beyond the limit', () => {
    expect(attitudeFromAcceleration({ x: 0, y: -1e6 }, 0)).toEqual({ pitchDeg: MAX_TILT_DEG, rollDeg: 0 });
  });

  it('does not change the authoritative path', () => {
    // Heading 90° after the turn, so strafing left moves the drone up the arena.
    expect(frameAt(timeline, timeline.totalSeconds).pose).toMatchObject({ x: 200, y: 30, altitude: 0 });
  });

  it('hover wobble is tiny, deterministic and absent on the ground', () => {
    expect(hoverWobble(3.21, 1)).toEqual(hoverWobble(3.21, 1));
    expect(hoverWobble(3.21, 0)).toEqual({ dyCm: 0, pitchDeg: 0, rollDeg: 0 });
    for (let t = 0; t < 10; t += 0.37) {
      const w = hoverWobble(t, 1);
      expect(Math.abs(w.dyCm)).toBeLessThanOrEqual(1.25);
      expect(Math.abs(w.pitchDeg)).toBeLessThanOrEqual(0.6);
    }
  });

  it('a crashed drone falls under gravity and comes to rest on the ground', () => {
    expect(crashFall(80, 0)).toEqual({ altitudeCm: 80, tiltDeg: 0 });
    expect(crashFall(80, 0.2).altitudeCm).toBeCloseTo(80 - 0.5 * 981 * 0.04, 6);
    expect(crashFall(80, 2)).toEqual({ altitudeCm: 0, tiltDeg: 28 });
  });
});

describe('follow camera line of sight', () => {
  const target = (x: number, y: number) => arenaToWorld(beginnerMaze, x, y, DEFAULT_FLIGHT_HEIGHT_CM);

  it('keeps the full distance when nothing is in the way', () => {
    // Open floor between the middle wall and the right-hand red zone.
    expect(clearViewScale(beginnerMaze, target(260, 180), { x: 60, y: 10, z: 0 })).toBe(1);
  });

  it('moves in front of a wall that would hide the drone', () => {
    // Start pad, camera on the drone's right: the tall wall at x = 100 is 50 cm away.
    const scale = clearViewScale(beginnerMaze, target(50, 250), { x: 120, y: 20, z: 0 });
    expect(120 * scale).toBeCloseTo(100 - CAMERA_CLEARANCE_CM - 50, 6);
  });

  it('stays inside the safety net', () => {
    const scale = clearViewScale(beginnerMaze, target(50, 250), { x: -120, y: 0, z: 0 });
    expect(120 * scale).toBeCloseTo(50 - CAMERA_CLEARANCE_CM, 6);
  });

  it('can look over a wall from above it', () => {
    // High enough to clear the 150 cm wall for the whole line of sight.
    expect(clearViewScale(beginnerMaze, arenaToWorld(beginnerMaze, 50, 250, 200), { x: 100, y: 20, z: 0 })).toBe(1);
  });
});

describe('room bounds and ceiling (classroom)', () => {
  const room = { minX: -400, maxX: 400, minZ: -300, maxZ: 300, maxY: 285 };

  it('stops the camera under the ceiling', () => {
    const scale = clearViewScale(beginnerMaze, { x: 50, y: 85, z: 0 }, { x: 0, y: 400, z: 0 }, room);
    expect(85 + 400 * scale).toBeCloseTo(285, 6);
  });

  it('keeps the overview camera inside the room', () => {
    const p = { x: 900, y: 500, z: -700 };
    clampToBounds(p, room);
    expect(p).toEqual({ x: 400, y: 285, z: -300 });
  });
});

describe('game-style camera smoothing', () => {
  it('reaches the target smoothly without overshooting', () => {
    const velocity = { v: 0 };
    let x = 0;
    const samples: number[] = [];
    for (let i = 0; i < 120; i++) {
      x = smoothDamp(x, 100, velocity, 0.3, 1 / 60);
      samples.push(x);
    }
    expect(samples.every((v, i) => v <= 100 && (i === 0 || v >= samples[i - 1]!))).toBe(true);
    expect(samples[17]!).toBeGreaterThan(40); // well on its way after 0.3 s
    expect(samples.at(-1)!).toBeCloseTo(100, 1);
  });

  it('gives the same path at 30 fps and 120 fps', () => {
    const run = (fps: number) => {
      const velocity = { v: 0 };
      let x = 0;
      for (let i = 0; i < fps / 2; i++) x = smoothDamp(x, 100, velocity, 0.3, 1 / fps);
      return x;
    };
    expect(Math.abs(run(30) - run(120))).toBeLessThan(1.5);
  });
});

describe('measuring tool', () => {
  it('snaps to nearby corners and reports what it snapped to', () => {
    expect(snapPoint(beginnerMaze, { x: 103, y: 112, heightCm: 1 })).toEqual({
      point: { x: 100, y: 110, heightCm: 0 },
      label: 'corner of Box wall',
    });
    expect(snapPoint(beginnerMaze, { x: 2, y: -1, heightCm: 0 }).label).toBe('arena corner');
    expect(snapPoint(beginnerMaze, { x: 121, y: 109, heightCm: 99 }).label).toBe('top corner of Box wall');
  });

  it('rounds free points to whole centimetres', () => {
    expect(snapPoint(beginnerMaze, { x: 260.4, y: 170.6, heightCm: 0.15 })).toEqual({
      point: { x: 260, y: 171, heightCm: 0 },
      label: null,
    });
  });

  it('measures distance and the across / along / up parts', () => {
    const a = snapPoint(beginnerMaze, { x: 0, y: 0, heightCm: 0 });
    const b = snapPoint(beginnerMaze, { x: 300, y: 400, heightCm: 0 });
    expect(measureBetween(a, b)).toMatchObject({ distanceCm: 500, acrossCm: 300, alongCm: 400, upCm: 0 });
    const top = snapPoint(beginnerMaze, { x: 100, y: 110, heightCm: 100 });
    expect(measureBetween(snapPoint(beginnerMaze, { x: 100, y: 110, heightCm: 0 }), top).upCm).toBe(100);
    expect(formatPoint(top.point)).toBe('x 100, y 110, 100 cm up');
  });
});

describe('measuring tool: snapping on screen', () => {
  const keys = keyPoints(beginnerMaze);
  const corner = keys.find((k) => k.label === 'corner of Box wall')!;
  const top = keys.find((k) => k.label === 'top corner of Box wall')!;

  it('snaps to the closest point within reach on screen', () => {
    expect(chooseSnap([{ key: corner, screenDistance: 12 }, { key: keys[0]!, screenDistance: 4 }], null)).toBe(keys[0]);
    expect(chooseSnap([{ key: corner, screenDistance: SNAP_RADIUS_PX + 1 }], null)).toBeNull();
  });

  it('prefers points at the height of the surface under the pointer', () => {
    // Seen from above, a box's top corner and the floor corner below it nearly overlap.
    const both = [
      { key: corner, screenDistance: 6 },
      { key: top, screenDistance: 9 },
    ];
    expect(chooseSnap(both, 100)).toBe(top);
    expect(chooseSnap(both, 0)).toBe(corner);
  });

  it('free points round to whole centimetres and never go below the floor', () => {
    expect(freePoint({ x: 10.4, y: 20.6, heightCm: -0.3 })).toEqual({ point: { x: 10, y: 21, heightCm: 0 }, label: null });
  });
});
