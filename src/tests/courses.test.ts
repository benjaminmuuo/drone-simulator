import { describe, expect, it } from 'vitest';
import { STARTER_PROGRAM_XML } from '../blocks/robolinkBlocks';
import { simulate } from '../engine/SimulationEngine';
import { COURSE_GROUPS, DEFAULT_MAZE, MAZES } from '../mazes';
import { DEFAULT_FLIGHT_HEIGHT_CM, OBSTACLE_CLEARANCE_CM } from '../mazes/constants';
import { coneBase, conesOf } from '../mazes/cones';
import { MIN_PATH_CLEARANCE_CM, PAD_CM } from '../mazes/courseRules';
import type { MazeDefinition, Point, Rect } from '../mazes/types';
import { validateMaze } from '../mazes/validateMaze';
import { parseRobolinkXml } from '../parser/RobolinkXmlParser';
import type { DroneCommand } from '../parser/types';

function commands(xml: string): readonly DroneCommand[] {
  const r = parseRobolinkXml(xml);
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('; '));
  return r.commands;
}

const distanceToRect = (p: Point, r: Rect) =>
  Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.width)), Math.max(r.y - p.y, 0, p.y - (r.y + r.height)));

/** Points every centimetre along the example's simulated route. */
function route(maze: MazeDefinition): Point[] {
  const result = simulate(commands(maze.exampleXml!), maze);
  const points: Point[] = [];
  for (const { before, after } of result.steps) {
    const n = Math.max(1, Math.ceil(Math.hypot(after.x - before.x, after.y - before.y)));
    for (let i = 0; i <= n; i++) points.push({ x: before.x + ((after.x - before.x) * i) / n, y: before.y + ((after.y - before.y) * i) / n });
  }
  return points;
}

const lessons = COURSE_GROUPS[0]!.courses;
const goalCourses = MAZES.filter((m) => m.id !== 'open-field');

describe('course list', () => {
  it('groups Flight School lessons 1–5, then the mazes, then free flight', () => {
    expect(COURSE_GROUPS.map((g) => [g.label, g.courses.map((c) => c.name)])).toEqual([
      [
        'Flight School',
        ['Lesson 1: First flight', 'Lesson 2: Turn right', 'Lesson 3: Turn left', 'Lesson 4: The square', 'Lesson 5: Figure eight'],
      ],
      ['Maze challenges', ['Maze 1: Zig-zag', 'Maze 2: Snake']],
      ['Free flight', ['Open Floor (practice)']],
    ]);
    expect(DEFAULT_MAZE.id).toBe('lesson-1');
  });
});

describe.each(MAZES.map((m) => [m.name, m] as const))('%s', (_name, maze) => {
  it('is a valid course', () => {
    expect(validateMaze(maze)).toEqual([]);
  });

  it('has an example program that completes it', () => {
    const result = simulate(commands(maze.exampleXml!), maze);
    expect(result.failure).toBeNull();
    expect(result.checkpointsVisited).toHaveLength(maze.checkpoints.length);
  });

  it('example keeps the drone 40 cm from walls and the arena edge', () => {
    const tall = maze.obstacles.filter((o) => (o.heightCm ?? Infinity) > DEFAULT_FLIGHT_HEIGHT_CM - OBSTACLE_CLEARANCE_CM);
    for (const p of route(maze)) {
      for (const o of tall) expect(distanceToRect(p, o)).toBeGreaterThanOrEqual(MIN_PATH_CLEARANCE_CM);
      expect(Math.min(p.x, p.y, maze.widthCm - p.x, maze.heightCm - p.y)).toBeGreaterThanOrEqual(MIN_PATH_CLEARANCE_CM);
    }
  });

  it('example uses tested moves: 50 cm steps and 90° turns', () => {
    for (const c of commands(maze.exampleXml!)) {
      if (c.type === 'MOVE') expect(c.distanceCm % 50).toBe(0);
      if (c.type === 'TURN') expect(c.degrees % 90).toBe(0);
    }
  });
});

describe.each(goalCourses.map((m) => [m.name, m] as const))('%s (goal)', (_name, maze) => {
  it('has a 50 × 50 cm landing pad', () => {
    expect([maze.landingZone.width, maze.landingZone.height]).toEqual([PAD_CM, PAD_CM]);
  });

  it('has no cone on its landing pad', () => {
    for (const cone of conesOf(maze)) {
      const base = coneBase(cone);
      const pad = maze.landingZone;
      const overlaps = base.x < pad.x + pad.width && pad.x < base.x + base.width && base.y < pad.y + pad.height && pad.y < base.y + base.height;
      expect(overlaps, `${cone.label} at (${cone.x}, ${cone.y})`).toBe(false);
    }
  });

  it('cannot be solved by just taking off and landing', () => {
    expect(simulate(commands(STARTER_PROGRAM_XML), maze).status).toBe('FAILED');
  });
});

describe('Flight School', () => {
  it('every lesson starts with take off and a 2 second hover', () => {
    for (const lesson of lessons) {
      const [first, second] = commands(lesson.exampleXml!);
      expect(first?.type).toBe('TAKEOFF');
      expect(second).toMatchObject({ type: 'HOVER', durationSeconds: 2 });
    }
  });

  it('lessons 2 and 3 turn right and left at the cone', () => {
    const turns = (i: number) => commands(lessons[i]!.exampleXml!).filter((c) => c.type === 'TURN');
    expect(turns(1)).toEqual([expect.objectContaining({ direction: 'RIGHT', degrees: 90 })]);
    expect(turns(2)).toEqual([expect.objectContaining({ direction: 'LEFT', degrees: 90 })]);
  });

  it('lesson 2 crashes if the drone keeps going instead of turning', () => {
    const straight = commands(lessons[1]!.exampleXml!).map((c) => (c.type === 'TURN' ? { ...c, degrees: 0 } : c));
    expect(simulate([...straight.slice(0, 3), { type: 'MOVE', direction: 'FORWARD', distanceCm: 100, blockId: null }], lessons[1]!).failure?.kind).toBe(
      'COLLISION_OBSTACLE',
    );
  });

  it('lesson 5 flies one square clockwise and one anticlockwise, ending where it started', () => {
    const lesson = lessons[4]!;
    const turns = commands(lesson.exampleXml!).filter((c) => c.type === 'TURN');
    expect(turns.map((t) => (t.type === 'TURN' ? t.direction : ''))).toEqual([...Array(4).fill('RIGHT'), ...Array(4).fill('LEFT')]);
    const end = simulate(commands(lesson.exampleXml!), lesson).finalState;
    expect([end.x, end.y, end.headingDeg]).toEqual([lesson.start.x, lesson.start.y, 0]);
  });
});
