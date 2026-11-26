import { programXml, repeat } from '../blocks/programXml';
import { ARENA, BOX_CM, DRONE_RADIUS_CM, GRID, PAD_CM, STACK_HEIGHT_CM, padAt } from './courseRules';
import type { MazeDefinition } from './types';

/**
 * Flight School: six short lessons, each adding one idea. All start with
 * take off + hover 2 s and use 90° turns. Lessons 1–5 move one grid box at a time
 * (44 cm forward across the width, 60 cm along the length) on the grid crossings of
 * the 300 × 220 cm taped arena. The start mark is never on the landing pad (except
 * where the route returns to it), so "take off, land" never passes.
 */

const common = { ...ARENA, ...GRID, startHeadingDeg: 0, noFlyZones: [], droneRadiusCm: DRONE_RADIUS_CM } as const;
const START = [['takeoff'], ['hover', 2]] as const;
const cone = (id: string, x: number, y: number, label = 'Corner cone') => ({ id, label, x, y, radiusCm: 15 });

/** Lesson 1: up and forward. Start (120, 176) → pad 44 cm ahead at (120, 132). */
export const lessonFirstFlight: MazeDefinition = {
  ...common,
  id: 'lesson-1',
  name: 'Lesson 1: First flight',
  description: 'Take off, hover for 2 seconds, fly forward 44 cm and land on the pad.',
  start: { x: 120, y: 176 },
  landingZone: padAt(120, 132),
  obstacles: [],
  checkpoints: [],
  exampleXml: programXml([...START, ['forward', 44], ['land']]),
};

/**
 * Lesson 2: a right turn. Start (120, 176) → corner cone (120, 132) → pad (180, 132).
 * A two-box stack 45 cm past the corner shows why the drone has to turn.
 */
export const lessonTurnRight: MazeDefinition = {
  ...common,
  id: 'lesson-2',
  name: 'Lesson 2: Turn right',
  description:
    'Boxes ahead! Take off, hover for 2 seconds, fly forward 44 cm to the cone, turn right 90° and fly 60 cm to land on the pad.',
  start: { x: 120, y: 176 },
  landingZone: padAt(180, 132),
  obstacles: [{ id: 'stack', label: 'Box stack', x: 120 - BOX_CM / 2, y: 47, width: BOX_CM, height: BOX_CM, heightCm: STACK_HEIGHT_CM }],
  checkpoints: [cone('corner', 120, 132)],
  exampleXml: programXml([...START, ['forward', 44], ['turn-right', 90], ['forward', 60], ['land']]),
};

/** Lesson 3: the mirror image of lesson 2. Start (180, 176) → cone (180, 132) → pad (120, 132). */
export const lessonTurnLeft: MazeDefinition = {
  ...common,
  id: 'lesson-3',
  name: 'Lesson 3: Turn left',
  description:
    'Boxes ahead again! Take off, hover for 2 seconds, fly forward 44 cm to the cone, turn left 90° and fly 60 cm to land on the pad.',
  start: { x: 180, y: 176 },
  landingZone: padAt(120, 132),
  obstacles: [{ id: 'stack', label: 'Box stack', x: 180 - BOX_CM / 2, y: 47, width: BOX_CM, height: BOX_CM, heightCm: STACK_HEIGHT_CM }],
  checkpoints: [cone('corner', 180, 132)],
  exampleXml: programXml([...START, ['forward', 44], ['turn-left', 90], ['forward', 60], ['land']]),
};

/**
 * Lesson 4: one grid box (44 × 60 cm), turning right at every corner, back onto the start pad.
 * Start (120, 176); corners (120, 132), (180, 132), (180, 176).
 */
export const lessonSquare: MazeDefinition = {
  ...common,
  id: 'lesson-4',
  name: 'Lesson 4: The rectangle',
  description:
    'Fly around one grid box: forward 44 cm, turn right, forward 60 cm, turn right, and repeat, passing all three corner cones. Land back on the pad you started from.',
  start: { x: 120, y: 176 },
  landingZone: padAt(120, 176),
  obstacles: [],
  checkpoints: [cone('corner-1', 120, 132), cone('corner-2', 180, 132), cone('corner-3', 180, 176)],
  exampleXml: programXml([...START, ...repeat(2, [['forward', 44], ['turn-right', 90], ['forward', 60], ['turn-right', 90]]), ['land']]),
};

/**
 * Lesson 5: two grid boxes from the same start: one clockwise (right turns) to the right,
 * then one anticlockwise (left turns) to the left. Start (120, 176).
 */
export const lessonFigureEight: MazeDefinition = {
  ...common,
  id: 'lesson-5',
  name: 'Lesson 5: Figure eight',
  description:
    'Two rectangles from the same start. First clockwise: forward 44 cm, turn right, forward 60 cm, turn right, twice. ' +
    'Then anticlockwise: the same moves turning left. Pass every cone and land back on the start pad.',
  start: { x: 120, y: 176 },
  landingZone: padAt(120, 176),
  obstacles: [],
  checkpoints: [
    cone('top', 120, 132, 'Middle cone'),
    cone('right-top', 180, 132),
    cone('right-bottom', 180, 176),
    cone('left-top', 60, 132),
    cone('left-bottom', 60, 176),
  ],
  exampleXml: programXml([
    ...START,
    ...repeat(2, [['forward', 44], ['turn-right', 90], ['forward', 60], ['turn-right', 90]]),
    ...repeat(2, [['forward', 44], ['turn-left', 90], ['forward', 60], ['turn-left', 90]]),
    ['land'],
  ]),
};

/**
 * Lesson 6: the big lap through the middle of all four corner boxes. Starts in the
 * bottom-right box (270, 198): forward 176 → (270, 22), left 240 → (30, 22),
 * left 176 → (30, 198), left 240 → back to the start, left to face forward, land.
 * It runs 22–30 cm from the floor edge, closer than the other courses.
 * The pad is shifted so it stays on the floor and clear of the corner cone.
 */
export const lessonBigSquare: MazeDefinition = {
  ...common,
  id: 'lesson-6',
  name: 'Lesson 6: Big square',
  description:
    'Start in the middle of the bottom-right box. Fly forward 176 cm, turn left, forward 240 cm, turn left, forward 176 cm, turn left, ' +
    'forward 240 cm, turn left and land back on the pad.',
  start: { x: 270, y: 198 },
  landingZone: { x: 235, y: 170, width: PAD_CM, height: PAD_CM },
  obstacles: [],
  checkpoints: [cone('corner-1', 270, 22), cone('corner-2', 30, 22), cone('corner-3', 30, 198)],
  exampleXml: programXml([...START, ...repeat(2, [['forward', 176], ['turn-left', 90], ['forward', 240], ['turn-left', 90]]), ['land']]),
};

export const LESSONS: readonly MazeDefinition[] = [
  lessonFirstFlight,
  lessonTurnRight,
  lessonTurnLeft,
  lessonSquare,
  lessonFigureEight,
  lessonBigSquare,
];
