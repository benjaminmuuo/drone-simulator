import { programXml } from '../blocks/programXml';
import type { ProgramStep } from '../blocks/programXml';
import { ARENA, DRONE_RADIUS_CM, GRID, padAt } from './courseRules';
import type { MazeDefinition } from './types';

/**
 * Activity 5 (instructor demo: flight words in code) and Activity 6 (student moves).
 * All fly on the empty 300 × 220 cm floor from its middle, with 50 cm moves, so nothing
 * comes near the floor edge. Each course's Example button loads the program from the lesson.
 * They are open flights: the drone may land anywhere, and students judge for themselves
 * whether it did what they expected (the pad only marks the start).
 */

const START = { x: 150, y: 110 } as const;
const openFloor = {
  ...ARENA,
  ...GRID,
  start: START,
  startHeadingDeg: 0,
  obstacles: [],
  noFlyZones: [],
  checkpoints: [],
  droneRadiusCm: DRONE_RADIUS_CM,
  landingZone: padAt(START.x, START.y),
  openLanding: true,
} as const;

const course = (
  id: string,
  name: string,
  description: string,
  steps: readonly ProgramStep[],
  extra: Partial<MazeDefinition> = {},
): MazeDefinition => ({
  ...openFloor,
  id,
  name,
  description,
  exampleXml: programXml([['takeoff'], ...steps, ['land']]),
  ...extra,
});

/** Activity 5: one flight word each. Ask "What will the drone do?" before pressing Run. */
export const FLIGHT_WORD_DEMOS: readonly MazeDefinition[] = [
  course(
    'demo-throttle',
    'Demo 1: Throttle up / down',
    'Take off, fly up 30 cm, fly down 30 cm, land. Students should see it rise, go higher, come down and land.',
    [['up', 30], ['down', 30]],
  ),
  course('demo-hover', 'Demo 2: Hover', 'Take off, hover 3 seconds, land. Students should see it rise and stay still.', [['hover', 3]]),
  course(
    'demo-pitch-forward',
    'Demo 3: Pitch forward',
    'Take off, fly forward 50 cm, land. Students should see it move forward and land ahead of the start.',
    [['forward', 50]],
  ),
  course(
    'demo-pitch-backward',
    'Demo 4: Pitch backward',
    'Take off, fly backward 50 cm, land. Students should see it move backward.',
    [['backward', 50]],
  ),
  course(
    'demo-roll',
    'Demo 5: Roll',
    'Take off, fly right 50 cm, fly left 50 cm, land. Students should see it slide sideways and back, without turning.',
    [['right', 50], ['left', 50]],
  ),
  course(
    'demo-yaw',
    'Demo 6: Yaw',
    'Take off, turn right 90°, turn left 90°, land. Students should see it turn on the spot, without moving. ' +
      'Ask: what is the difference between roll and yaw?',
    [['turn-right', 90], ['turn-left', 90]],
  ),
];

/** Activity 6: Plan, Build, Simulate, Fly, Compare. */
export const STUDENT_MOVES: readonly MazeDefinition[] = [
  course(
    'move-up-down',
    'Move 1: Up and down',
    'Take off, hover 5 seconds, land. It should rise, hold still and land on the start mark.',
    [['hover', 5]],
  ),
  course(
    'move-out-back',
    'Move 2: Out and back',
    'Take off, fly forward 50 cm, fly backward 50 cm, land. It should go out and come back to the start mark.',
    [['forward', 50], ['backward', 50]],
  ),
  course(
    'move-look-around',
    'Move 3: Look around',
    'Take off, turn right 90° four times, land. It should spin a full circle on the spot and land facing the way it started.',
    [['turn-right', 90], ['turn-right', 90], ['turn-right', 90], ['turn-right', 90]],
  ),
  course(
    'move-look-around-loop',
    'Move 3 extension: Look around with a loop',
    'The same full circle, built with a Repeat 4 times loop around one turn right 90° block. ' +
      'Which version is shorter? Which is easier to change?',
    [['repeat', 4, [['turn-right', 90]]]],
  ),
  course(
    'move-our-own',
    'Move 4: Our own move',
    'Design your own move: up to 5 blocks between Take off and Land, in the open space. ' +
      'Ideas: step and look, side step, lift and spin, corner.',
    [['forward', 50], ['turn-right', 90], ['hover', 3]],
    { maxBlocksBetween: 5 },
  ),
];

/** The Move 4 example ideas from the lesson, for checking they all pass. */
export const OWN_MOVE_IDEAS: Readonly<Record<string, readonly ProgramStep[]>> = {
  'Step and look': [['forward', 50], ['turn-right', 90], ['hover', 3]],
  'Side step': [['right', 50], ['hover', 3], ['left', 50]],
  'Lift and spin': [['up', 30], ['turn-left', 180], ['down', 30]],
  Corner: [['forward', 50], ['right', 50], ['backward', 50], ['left', 50]],
};
