import { programXml, repeat } from '../blocks/programXml';
import { ARENA, BOX_CM, DRONE_RADIUS_CM, GRID_CM, STACK_HEIGHT_CM, padAt } from './courseRules';
import type { MazeDefinition } from './types';

/**
 * Flight School: five short lessons, each adding one idea. All start with
 * take off + hover 2 s, use 50 cm moves and 90° turns, and fit in the middle
 * of the same 4 × 3 m taped arena. The start mark is never on the landing
 * pad (except where the route returns to it), so "take off, land" never passes.
 */

const common = { ...ARENA, startHeadingDeg: 0, noFlyZones: [], droneRadiusCm: DRONE_RADIUS_CM, gridSpacingCm: GRID_CM } as const;
const START = [['takeoff'], ['hover', 2]] as const;
const cone = (id: string, x: number, y: number, label = 'Corner cone') => ({ id, label, x, y, radiusCm: 15 });

/** Lesson 1: up and forward. Start (200, 250) → pad 50 cm ahead at (200, 200). */
export const lessonFirstFlight: MazeDefinition = {
  ...common,
  id: 'lesson-1',
  name: 'Lesson 1: First flight',
  description: 'Take off, hover for 2 seconds, fly forward 50 cm and land on the pad.',
  start: { x: 200, y: 250 },
  landingZone: padAt(200, 200),
  obstacles: [],
  checkpoints: [],
  exampleXml: programXml([...START, ['forward', 50], ['land']]),
};

/**
 * Lesson 2: a right turn. Start (150, 250) → corner cone (150, 200) → pad (200, 200).
 * A two-box stack 45 cm past the corner shows why the drone has to turn.
 */
export const lessonTurnRight: MazeDefinition = {
  ...common,
  id: 'lesson-2',
  name: 'Lesson 2: Turn right',
  description:
    'Boxes ahead! Take off, hover for 2 seconds, fly forward 50 cm to the cone, turn right 90° and fly 50 cm to land on the pad.',
  start: { x: 150, y: 250 },
  landingZone: padAt(200, 200),
  obstacles: [{ id: 'stack', label: 'Box stack', x: 150 - BOX_CM / 2, y: 115, width: BOX_CM, height: BOX_CM, heightCm: STACK_HEIGHT_CM }],
  checkpoints: [cone('corner', 150, 200)],
  exampleXml: programXml([...START, ['forward', 50], ['turn-right', 90], ['forward', 50], ['land']]),
};

/** Lesson 3: the mirror image of lesson 2. Start (250, 250) → cone (250, 200) → pad (200, 200). */
export const lessonTurnLeft: MazeDefinition = {
  ...common,
  id: 'lesson-3',
  name: 'Lesson 3: Turn left',
  description:
    'Boxes ahead again! Take off, hover for 2 seconds, fly forward 50 cm to the cone, turn left 90° and fly 50 cm to land on the pad.',
  start: { x: 250, y: 250 },
  landingZone: padAt(200, 200),
  obstacles: [{ id: 'stack', label: 'Box stack', x: 250 - BOX_CM / 2, y: 115, width: BOX_CM, height: BOX_CM, heightCm: STACK_HEIGHT_CM }],
  checkpoints: [cone('corner', 250, 200)],
  exampleXml: programXml([...START, ['forward', 50], ['turn-left', 90], ['forward', 50], ['land']]),
};

/**
 * Lesson 4: a 50 cm square, turning right at every corner, back onto the start pad.
 * Start (175, 250); corners (175, 200), (225, 200), (225, 250).
 */
export const lessonSquare: MazeDefinition = {
  ...common,
  id: 'lesson-4',
  name: 'Lesson 4: The square',
  description:
    'Fly a 50 cm square: forward 50 cm and turn right 90°, four times, passing all three corner cones. Land back on the pad you started from.',
  start: { x: 175, y: 250 },
  landingZone: padAt(175, 250),
  obstacles: [],
  checkpoints: [cone('corner-1', 175, 200), cone('corner-2', 225, 200), cone('corner-3', 225, 250)],
  exampleXml: programXml([...START, ...repeat(4, [['forward', 50], ['turn-right', 90]]), ['land']]),
};

/**
 * Lesson 5: two squares from the same start: one clockwise (right turns) to the right,
 * then one anticlockwise (left turns) to the left. Start (200, 250).
 */
export const lessonFigureEight: MazeDefinition = {
  ...common,
  id: 'lesson-5',
  name: 'Lesson 5: Figure eight',
  description:
    'Two squares from the same start. First clockwise: forward 50 cm and turn right, four times. Then anticlockwise: forward 50 cm and turn left, four times. ' +
    'Pass every cone and land back on the start pad.',
  start: { x: 200, y: 250 },
  landingZone: padAt(200, 250),
  obstacles: [],
  checkpoints: [
    cone('top', 200, 200, 'Middle cone'),
    cone('right-top', 250, 200),
    cone('right-bottom', 250, 250),
    cone('left-top', 150, 200),
    cone('left-bottom', 150, 250),
  ],
  exampleXml: programXml([
    ...START,
    ...repeat(4, [['forward', 50], ['turn-right', 90]]),
    ...repeat(4, [['forward', 50], ['turn-left', 90]]),
    ['land'],
  ]),
};

export const LESSONS: readonly MazeDefinition[] = [
  lessonFirstFlight,
  lessonTurnRight,
  lessonTurnLeft,
  lessonSquare,
  lessonFigureEight,
];
