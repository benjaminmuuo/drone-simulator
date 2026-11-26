import { describe, expect, it } from 'vitest';
import { programXml } from '../blocks/programXml';
import type { ProgramStep } from '../blocks/programXml';
import { STARTER_PROGRAM_XML } from '../blocks/robolinkBlocks';
import { simulate } from '../engine/SimulationEngine';
import { COURSE_GROUPS, DEFAULT_MAZE, MAZES } from '../mazes';
import { DEFAULT_FLIGHT_HEIGHT_CM, OBSTACLE_CLEARANCE_CM } from '../mazes/constants';
import { coneBase, conesOf } from '../mazes/cones';
import { FLIGHT_WORD_DEMOS, OWN_MOVE_IDEAS, STUDENT_MOVES } from '../mazes/flightWords';
import { GRID, MIN_PATH_CLEARANCE_CM, PAD_CM } from '../mazes/courseRules';
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
/** Activity 5 and 6 courses: 50 cm moves from the middle of the floor, most landing back on the start mark. */
const FLIGHT_WORDS: readonly MazeDefinition[] = [...FLIGHT_WORD_DEMOS, ...STUDENT_MOVES];
const isFlightWords = (m: MazeDefinition) => FLIGHT_WORDS.includes(m);
/** Courses with a route to find: the lessons and the mazes. */
const goalCourses = MAZES.filter((m) => m.id !== 'open-field' && !isFlightWords(m));
/** The lap through the middle of the corner boxes runs closer to the floor edge than the other courses. */
const BIG_SQUARE = 'lesson-6';
const BIG_SQUARE_EDGE_CM = 22;

describe('course list', () => {
  it('groups Flight School lessons 1–6, then the mazes, free flight, the demos and the student moves', () => {
    expect(COURSE_GROUPS.map((g) => [g.label, g.courses.map((c) => c.name)])).toEqual([
      [
        'Flight School',
        ['Lesson 1: First flight', 'Lesson 2: Turn right', 'Lesson 3: Turn left', 'Lesson 4: The rectangle', 'Lesson 5: Figure eight', 'Lesson 6: Big square'],
      ],
      ['Maze challenges', ['Maze 1: Zig-zag', 'Maze 2: Snake']],
      ['Free flight', ['Open Floor (practice)']],
      [
        'Flight words (instructor demo)',
        ['Demo 1: Throttle up / down', 'Demo 2: Hover', 'Demo 3: Pitch forward', 'Demo 4: Pitch backward', 'Demo 5: Roll', 'Demo 6: Yaw'],
      ],
      [
        'Student moves',
        ['Move 1: Up and down', 'Move 2: Out and back', 'Move 3: Look around', 'Move 3 extension: Look around with a loop', 'Move 4: Our own move'],
      ],
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
      expect(Math.min(p.x, p.y, maze.widthCm - p.x, maze.heightCm - p.y)).toBeGreaterThanOrEqual(maze.id === BIG_SQUARE ? BIG_SQUARE_EDGE_CM : MIN_PATH_CLEARANCE_CM);
    }
  });

  it.skipIf(isFlightWords(maze))('example moves in whole grid boxes and turns 90°', () => {
    for (const { before, after } of simulate(commands(maze.exampleXml!), maze).steps) {
      const across = Math.abs(after.x - before.x) / GRID.gridSpacingCm;
      const along = Math.abs(after.y - before.y) / GRID.gridSpacingYCm;
      expect(across).toBeCloseTo(Math.round(across), 6);
      expect(along).toBeCloseTo(Math.round(along), 6);
    }
    for (const c of commands(maze.exampleXml!)) {
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

  it('lesson 5 flies one rectangle clockwise and one anticlockwise, ending where it started', () => {
    const lesson = lessons[4]!;
    const turns = commands(lesson.exampleXml!).filter((c) => c.type === 'TURN');
    expect(turns.map((t) => (t.type === 'TURN' ? t.direction : ''))).toEqual([...Array(4).fill('RIGHT'), ...Array(4).fill('LEFT')]);
    const end = simulate(commands(lesson.exampleXml!), lesson).finalState;
    expect([end.x, end.y, end.headingDeg]).toEqual([lesson.start.x, lesson.start.y, 0]);
  });
});

describe('Flight words and student moves', () => {
  const byId = (id: string) => FLIGHT_WORDS.find((m) => m.id === id)!;
  const fly = (id: string, steps: readonly ProgramStep[]) => simulate(commands(programXml([['takeoff'], ...steps, ['land']])), byId(id));
  const heights = (id: string) => simulate(commands(byId(id).exampleXml!), byId(id)).steps.map((s) => s.after.heightCm);

  it('demo 1 rises to flight height, goes 30 cm higher, comes back down and lands', () => {
    expect(heights('demo-throttle')).toEqual([DEFAULT_FLIGHT_HEIGHT_CM, DEFAULT_FLIGHT_HEIGHT_CM + 30, DEFAULT_FLIGHT_HEIGHT_CM, 0]);
  });

  it('roll slides without turning; yaw turns without moving', () => {
    const roll = simulate(commands(byId('demo-roll').exampleXml!), byId('demo-roll')).steps;
    expect(roll.map((s) => s.after.headingDeg)).toEqual([0, 0, 0, 0]);
    expect(roll[1]!.after.x - roll[1]!.before.x).toBe(50);
    const yaw = simulate(commands(byId('demo-yaw').exampleXml!), byId('demo-yaw')).steps;
    expect(yaw.map((s) => [s.after.x, s.after.y])).toEqual(yaw.map(() => [150, 110]));
    expect(yaw[1]!.after.headingDeg).toBe(90);
  });

  it.each(FLIGHT_WORDS.map((m) => [m.name, m.id] as const))('%s is an open flight: it can land anywhere, facing any way', (_name, id) => {
    expect(fly(id, [['forward', 80], ['turn-right', 90], ['right', 100]]).failure).toBeNull();
  });

  it('open flights still fail on leaving the floor', () => {
    expect(fly('demo-hover', [['forward', 200]]).failure?.kind).toBe('OUT_OF_BOUNDS');
  });

  it('Open Floor is an open flight too', () => {
    const open = MAZES.find((m) => m.id === 'open-field')!;
    expect(simulate(commands(programXml([['takeoff'], ['left', 100], ['land']])), open).failure).toBeNull();
  });

  it('Move 3 with a loop flies exactly the same as Move 3 written out', () => {
    const strip = (xml: string) => commands(xml).map(({ blockId: _id, ...c }) => c);
    expect(strip(byId('move-look-around-loop').exampleXml!)).toEqual(strip(byId('move-look-around').exampleXml!));
  });

  it.each(Object.entries(OWN_MOVE_IDEAS))('Move 4 idea "%s" passes', (_name, steps) => {
    expect(fly('move-our-own', steps).failure).toBeNull();
  });

  it('Move 4 allows at most 5 blocks between Take off and Land', () => {
    const five: ProgramStep[] = [['forward', 50], ['right', 50], ['backward', 50], ['left', 50], ['hover', 1]];
    expect(fly('move-our-own', five).failure).toBeNull();
    expect(fly('move-our-own', [...five, ['hover', 1]]).failure).toMatchObject({ kind: 'TOO_MANY_BLOCKS', message: expect.stringContaining('6 blocks') });
  });

  it('Move 4 counts the blocks inside a loop once, however often they run', () => {
    expect(fly('move-our-own', [['repeat', 8, [['turn-right', 90]]], ['hover', 1]]).failure).toBeNull();
  });
});
