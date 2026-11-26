import { programXml } from '../blocks/programXml';
import { ARENA, BOX_CM, DRONE_RADIUS_CM, GRID, WALL_HEIGHT_CM, padAt } from './courseRules';
import type { MazeDefinition } from './types';

/**
 * Maze challenges: fly from the start mark to the finish pad through box walls,
 * using only what Flight School taught (whole grid boxes, 90° turns). Routes follow
 * the grid lines. Walls are one box deep (40 cm), and every route stays at least
 * 40 cm from each wall face and from the edge of the 300 × 220 cm floor.
 */

const common = { ...ARENA, ...GRID, startHeadingDeg: 0, noFlyZones: [], droneRadiusCm: DRONE_RADIUS_CM } as const;
const wall = (id: string, label: string, x: number, y: number, height: number) => ({
  id,
  label,
  x,
  y,
  width: BOX_CM,
  height,
  heightCm: WALL_HEIGHT_CM,
});

/**
 * Route: start (60, 176) ↑132 → (60, 44), right 180 → (240, 44), right ↓132 → finish pad
 * at (240, 176).
 */
export const mazeZigZag: MazeDefinition = {
  ...common,
  id: 'maze-1',
  name: 'Maze 1: Zig-zag',
  description:
    'Fly from the start mark to the finish pad. Go up the left corridor, across the top of the box wall, ' +
    'then down the other side to the finish. Pass the cone on the way.',
  start: { x: 60, y: 176 },
  landingZone: padAt(240, 176),
  obstacles: [wall('wall-1', 'Box wall', 130, 84, 136)],
  checkpoints: [{ id: 'cone', label: 'Cone', x: 120, y: 44, radiusCm: 15 }],
  exampleXml: programXml([
    ['takeoff'],
    ['hover', 2],
    ['forward', 132],
    ['turn-right', 90],
    ['forward', 180],
    ['turn-right', 90],
    ['forward', 132],
    ['land'],
  ]),
};

/**
 * Route: start (60, 176) ↑44 → (60, 132), right 120 → (180, 132), left ↑88 → (180, 44),
 * right 60 → (240, 44), right ↓132 → finish pad at (240, 176).
 */
export const mazeSnake: MazeDefinition = {
  ...common,
  id: 'maze-2',
  name: 'Maze 2: Snake',
  description:
    'A longer route with four turns, three right and one left. Snake between the box walls from the start mark to the finish pad, ' +
    'passing both cones.',
  start: { x: 60, y: 176 },
  landingZone: padAt(240, 176),
  obstacles: [
    wall('wall-1', 'First box wall', 100, 0, 92),
    wall('wall-2', 'Second box wall', 130, 172, 48),
  ],
  checkpoints: [
    { id: 'cone-1', label: 'First cone', x: 120, y: 132, radiusCm: 15 },
    { id: 'cone-2', label: 'Second cone', x: 180, y: 88, radiusCm: 15 },
  ],
  exampleXml: programXml([
    ['takeoff'],
    ['hover', 2],
    ['forward', 44],
    ['turn-right', 90],
    ['forward', 120],
    ['turn-left', 90],
    ['forward', 88],
    ['turn-right', 90],
    ['forward', 60],
    ['turn-right', 90],
    ['forward', 132],
    ['land'],
  ]),
};

export const CHALLENGES: readonly MazeDefinition[] = [mazeZigZag, mazeSnake];
