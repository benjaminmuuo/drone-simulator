import { programXml } from '../blocks/programXml';
import { ARENA, BOX_CM, DRONE_RADIUS_CM, GRID_CM, WALL_HEIGHT_CM, padAt } from './courseRules';
import type { MazeDefinition } from './types';

/**
 * Maze challenges: fly from the start mark to the finish pad through box walls,
 * using only what Flight School taught (forward moves in 50 cm steps, 90° turns).
 * Corridors are ~150 cm apart with a one-box-deep wall (40 cm) between them, so the
 * route is 50–55 cm from every wall face.
 */

const common = { ...ARENA, startHeadingDeg: 0, noFlyZones: [], droneRadiusCm: DRONE_RADIUS_CM, gridSpacingCm: GRID_CM } as const;
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
 * Route: start (50, 250) ↑150 → (50, 100), right ↑150 → (200, 100), right ↓100 → (200, 200),
 * left → 150 to the finish pad at (350, 200).
 */
export const mazeZigZag: MazeDefinition = {
  ...common,
  id: 'maze-1',
  name: 'Maze 1: Zig-zag',
  description:
    'Fly from the start mark to the finish pad. Go up the left corridor, over the first box wall, down between the walls, ' +
    'then along to the finish. Pass the cone on the way.',
  start: { x: 50, y: 250 },
  landingZone: padAt(350, 200),
  obstacles: [
    wall('wall-1', 'First box wall', 105, 150, 150),
    wall('wall-2', 'Second box wall', 255, 0, 150),
  ],
  checkpoints: [{ id: 'cone', label: 'Cone', x: 125, y: 100, radiusCm: 15 }],
  exampleXml: programXml([
    ['takeoff'],
    ['hover', 2],
    ['forward', 150],
    ['turn-right', 90],
    ['forward', 150],
    ['turn-right', 90],
    ['forward', 100],
    ['turn-left', 90],
    ['forward', 150],
    ['land'],
  ]),
};

/**
 * Route: start (350, 250) ↑150 → (350, 100), left 150 → (200, 100), left ↓100 → (200, 200),
 * right 150 → (50, 200), right ↑100 → finish pad at (50, 100).
 */
export const mazeSnake: MazeDefinition = {
  ...common,
  id: 'maze-2',
  name: 'Maze 2: Snake',
  description:
    'A longer route with four turns, two left and two right. Snake between the box walls from the start mark to the finish pad, ' +
    'passing both cones.',
  start: { x: 350, y: 250 },
  landingZone: padAt(50, 100),
  obstacles: [
    wall('wall-1', 'First box wall', 255, 150, 150),
    wall('wall-2', 'Second box wall', 105, 0, 150),
  ],
  checkpoints: [
    { id: 'cone-1', label: 'First cone', x: 275, y: 100, radiusCm: 15 },
    { id: 'cone-2', label: 'Second cone', x: 125, y: 200, radiusCm: 15 },
  ],
  exampleXml: programXml([
    ['takeoff'],
    ['hover', 2],
    ['forward', 150],
    ['turn-left', 90],
    ['forward', 150],
    ['turn-left', 90],
    ['forward', 100],
    ['turn-right', 90],
    ['forward', 150],
    ['turn-right', 90],
    ['forward', 100],
    ['land'],
  ]),
};

export const CHALLENGES: readonly MazeDefinition[] = [mazeZigZag, mazeSnake];
