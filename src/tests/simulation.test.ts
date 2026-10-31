import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SimulationEngine, simulate } from '../engine/SimulationEngine';
import { beginnerMaze, boxSlalom } from './fixtures/testMazes';
import { MAZES } from '../mazes';
import { openField } from '../mazes/open-field';
import type { MazeDefinition } from '../mazes/types';
import { validateMaze } from '../mazes/validateMaze';
import { parseRobolinkXml } from '../parser/RobolinkXmlParser';
import type { DroneCommand } from '../parser/types';

const takeoff: DroneCommand = { type: 'TAKEOFF', blockId: 'to' };
const land: DroneCommand = { type: 'LAND', blockId: 'ld' };
const forward = (distanceCm: number, blockId = 'fw'): DroneCommand => ({
  type: 'MOVE',
  direction: 'FORWARD',
  distanceCm,
  blockId,
});
const right = (degrees: number): DroneCommand => ({ type: 'TURN', direction: 'RIGHT', degrees, blockId: 'tr' });
const left = (degrees: number): DroneCommand => ({ type: 'TURN', direction: 'LEFT', degrees, blockId: 'tl' });

describe('reference program on the beginner maze', () => {
  const parsed = parseRobolinkXml(readFileSync(resolve(__dirname, 'fixtures/main.xml'), 'utf8'));
  if (!parsed.ok) throw new Error('fixture failed to parse');
  const result = simulate(parsed.commands, beginnerMaze);

  it('completes the mission', () => {
    expect(result.failure).toBeNull();
    expect(result.status).toBe('SUCCESS');
    expect(result.checkpointsVisited).toEqual(['flag']);
  });

  it('follows the expected U-shaped path', () => {
    expect(result.steps.map((s) => [s.after.x, s.after.y, s.after.headingDeg, s.after.flight])).toEqual([
      [50, 250, 0, 'FLYING'],
      [50, 250, 0, 'FLYING'],
      [50, 200, 0, 'FLYING'],
      [50, 200, 90, 'FLYING'],
      [60, 200, 90, 'FLYING'],
      [60, 200, 180, 'FLYING'],
      [60, 250, 180, 'FLYING'],
      [60, 250, 180, 'LANDED'],
    ]);
  });
});

describe('lifecycle', () => {
  it('takeoff and land change only the flight state', () => {
    const engine = new SimulationEngine(openField);
    expect(engine.execute(takeoff, 0).after).toEqual({ x: 200, y: 150, headingDeg: 0, flight: 'FLYING' });
    expect(engine.execute(land, 1).after).toEqual({ x: 200, y: 150, headingDeg: 0, flight: 'LANDED' });
  });

  it('rejects moving before takeoff without changing state', () => {
    const engine = new SimulationEngine(openField);
    const step = engine.execute(forward(10, 'early'), 0);
    expect(step.failure).toMatchObject({ kind: 'NOT_FLYING', commandIndex: 0, blockId: 'early' });
    expect(step.after).toEqual(step.before);
    expect(engine.getState().flight).toBe('LANDED');
  });

  it.each<DroneCommand>([land, { type: 'HOVER', durationSeconds: 1, blockId: 'h' }, right(90)])(
    'rejects $type while landed',
    (command) => {
      expect(simulate([command], openField).failure?.kind).toBe('NOT_FLYING');
    },
  );

  it('rejects a second takeoff while flying', () => {
    const result = simulate([takeoff, { ...takeoff, blockId: 'again' }, land], openField);
    expect(result.failure).toMatchObject({ kind: 'ALREADY_FLYING', commandIndex: 1, blockId: 'again' });
    expect(result.steps).toHaveLength(2);
  });

  it('allows landing and taking off again', () => {
    expect(simulate([takeoff, land, takeoff, land], openField).status).toBe('SUCCESS');
  });

  it('fails when the program ends in the air', () => {
    expect(simulate([takeoff, forward(10)], openField).failure?.kind).toBe('NOT_LANDED');
  });

  it('fails when landing outside the landing zone', () => {
    const result = simulate([takeoff, forward(100), land], openField);
    expect(result.failure?.kind).toBe('LANDED_OUTSIDE_ZONE');
    expect(result.finalState).toMatchObject({ x: 200, y: 50, flight: 'LANDED' });
  });

  it('fails an empty program', () => {
    expect(simulate([], openField).failure?.kind).toBe('EMPTY_PROGRAM');
  });
});

describe('hover and rotation', () => {
  it('hover preserves position and heading', () => {
    const engine = new SimulationEngine(openField);
    engine.execute(takeoff, 0);
    engine.execute(right(45), 1);
    const step = engine.execute({ type: 'HOVER', durationSeconds: 5, blockId: 'h' }, 2);
    expect(step.failure).toBeNull();
    expect(step.after).toEqual(step.before);
  });

  it('rotation keeps position and accumulates heading', () => {
    const result = simulate([takeoff, right(90), right(90), right(90), right(90), land], openField);
    expect(result.steps.map((s) => s.after.headingDeg)).toEqual([0, 90, 180, 270, 0, 0]);
    expect(result.finalState).toMatchObject({ x: 200, y: 150 });
  });

  it('moves along the rotated heading', () => {
    const result = simulate([takeoff, right(90), forward(30), land], openField);
    expect(result.steps[2]?.after).toMatchObject({ x: 230, y: 150 });
  });
});

describe('collisions during simulation', () => {
  it('stops at an obstacle, keeps the last valid position, and reports the block', () => {
    // From (50,250) the hanging box bottom is at y=90; drone radius 8 → hits at y=98.
    const result = simulate([takeoff, forward(100, 'safe'), forward(100, 'crash'), land], beginnerMaze);
    expect(result.status).toBe('FAILED');
    expect(result.failure).toMatchObject({
      kind: 'COLLISION_OBSTACLE',
      commandIndex: 2,
      blockId: 'crash',
      zoneId: 'ceiling-block',
    });
    expect(result.failure?.contactPoint?.y).toBeCloseTo(98, 6);
    expect(result.finalState).toEqual({ x: 50, y: 150, headingDeg: 0, flight: 'FLYING' });
    expect(result.steps).toHaveLength(3);
  });

  it('cannot tunnel through a thin wall with one long move', () => {
    const thinWall: MazeDefinition = {
      ...openField,
      obstacles: [{ id: 'thin', label: 'Thin wall', x: 250, y: 0, width: 1, height: 300 }],
    };
    const result = simulate([takeoff, right(90), forward(100)], thinWall);
    expect(result.failure).toMatchObject({ kind: 'COLLISION_OBSTACLE', zoneId: 'thin' });
    expect(result.finalState.x).toBe(200);
  });

  it('detects restricted zones', () => {
    const result = simulate([takeoff, right(90), forward(150)], beginnerMaze);
    // Heading right from (50, 250) the tall wall at x=100 is hit first.
    expect(result.failure?.kind).toBe('COLLISION_OBSTACLE');

    const zoned: MazeDefinition = {
      ...openField,
      noFlyZones: [{ id: 'nfz', label: 'Red zone', x: 180, y: 40, width: 40, height: 20 }],
    };
    expect(simulate([takeoff, forward(100), land], zoned).failure).toMatchObject({ kind: 'NO_FLY_ZONE', zoneId: 'nfz' });
  });

  it('detects arena boundaries', () => {
    const result = simulate([takeoff, forward(200), land], openField);
    expect(result.failure?.kind).toBe('OUT_OF_BOUNDS');
    expect(result.failure?.contactPoint).toEqual({ x: 200, y: 8 });
    expect(result.finalState).toMatchObject({ x: 200, y: 150 });
  });

  it('fails if a required checkpoint is skipped', () => {
    const result = simulate([takeoff, land], beginnerMaze);
    expect(result.failure?.kind).toBe('CHECKPOINT_MISSED');
  });
});

describe('determinism', () => {
  it('produces identical results across runs and engine resets', () => {
    const program = [takeoff, right(37), forward(41.3), right(200), forward(12.7), land];
    const engine = new SimulationEngine(openField);
    const a = engine.run(program);
    const b = engine.run(program);
    expect(b).toEqual(a);
    expect(simulate(program, openField)).toEqual(a);
  });

  it('reset restores the starting state', () => {
    const engine = new SimulationEngine(beginnerMaze);
    engine.run([takeoff, forward(50)]);
    engine.reset();
    expect(engine.getState()).toEqual({ x: 50, y: 250, headingDeg: 0, flight: 'LANDED' });
    expect(engine.getVisitedCheckpoints()).toEqual([]);
  });
});

describe('maze configuration', () => {
  it.each(MAZES.map((m) => [m.id, m] as const))('built-in maze "%s" is valid', (_id, m) => {
    expect(validateMaze(m)).toEqual([]);
  });

  it('beginner maze is about 400 × 300 cm', () => {
    expect([beginnerMaze.widthCm, beginnerMaze.heightCm]).toEqual([400, 300]);
  });

  it('rejects inconsistent geometry', () => {
    const broken: MazeDefinition = {
      ...openField,
      start: { x: 2, y: 150 },
      obstacles: [
        { id: 'outside', label: 'x', x: 390, y: 10, width: 50, height: 10 },
        { id: 'outside', label: 'dup', x: 10, y: 10, width: 10, height: 10 },
      ],
      checkpoints: [{ id: 'cp', label: 'cp', x: 15, y: 15, radiusCm: 5 }],
    };
    const problems = validateMaze(broken);
    expect(problems).toEqual(
      expect.arrayContaining([
        'The drone does not fit inside the arena at the start position.',
        'Obstacle "outside" is outside the arena or has no size.',
        'Duplicate id "outside".',
        'Checkpoint "cp" is inside "outside".',
      ]),
    );
  });

  it('rejects a start position inside an obstacle', () => {
    const blocked: MazeDefinition = {
      ...openField,
      obstacles: [{ id: 'o', label: 'o', x: 190, y: 140, width: 20, height: 20 }],
    };
    expect(validateMaze(blocked)).toContain('The start position overlaps obstacle "o".');
  });
});

describe('real block heights and the flight height setting', () => {
  // The documented solution for Box Slalom; its first leg passes over a 40 cm box.
  const slalom = [takeoff, forward(150, 'leg1'), left(90), forward(180), right(90), forward(140), land];

  it('flies over a box lower than the flight height', () => {
    const result = simulate(slalom, boxSlalom);
    expect(result.failure).toBeNull();
    expect(result.checkpointsVisited).toEqual(['cone']);
  });

  it('defaults to an 80 cm flight height', () => {
    expect(simulate(slalom, boxSlalom, { flightHeightCm: 80 })).toEqual(simulate(slalom, boxSlalom));
  });

  it('crashes into the same box when flying too low to clear it', () => {
    // 40 cm box, 40 cm flight height: the safety gap means it counts as a hit.
    const failure = simulate(slalom, boxSlalom, { flightHeightCm: 40 }).failure;
    expect(failure).toMatchObject({ kind: 'COLLISION_OBSTACLE', zoneId: 'low-box', blockId: 'leg1' });
  });

  it('needs a 10 cm safety gap above the box', () => {
    expect(simulate(slalom, boxSlalom, { flightHeightCm: 49 }).failure?.zoneId).toBe('low-box');
    expect(simulate(slalom, boxSlalom, { flightHeightCm: 50 }).failure).toBeNull();
  });

  it('can clear a tall box wall when the drone flies above it', () => {
    // Straight across both walls (100 cm high): only possible above 110 cm.
    const straight = [takeoff, forward(260), left(90), forward(150), right(90), forward(40), land];
    expect(simulate(straight, boxSlalom).failure?.zoneId).toBe('wall-b');
    expect(simulate(straight, boxSlalom, { flightHeightCm: 120 }).failure?.kind).not.toBe('COLLISION_OBSTACLE');
  });

  it('does not let the drone land on top of a low box', () => {
    const result = simulate([takeoff, forward(60, 'over'), land], boxSlalom);
    expect(result.failure).toMatchObject({ kind: 'COLLISION_OBSTACLE', zoneId: 'low-box', commandIndex: 2 });
    expect(result.failure?.message).toContain('land on top of "Low box"');
    expect(result.finalState).toMatchObject({ x: 110, y: 240, flight: 'FLYING' });
  });

  it('never lets the drone fly through a no-fly zone, whatever the height', () => {
    // At 150 cm it clears both box walls, but the red zone still counts.
    expect(simulate([takeoff, forward(300)], boxSlalom, { flightHeightCm: 150 }).failure?.kind).toBe('NO_FLY_ZONE');
  });
});
