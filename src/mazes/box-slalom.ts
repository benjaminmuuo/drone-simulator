import type { MazeDefinition } from './types';

/**
 * Slalom between two tall box walls, over a single low box. One solution:
 * takeoff, forward 150, turn left 90, forward 180, turn right 90,
 * forward 140, land.
 */
export const boxSlalom: MazeDefinition = {
  id: 'box-slalom',
  name: 'Box Slalom',
  description:
    'Weave around the two tall box walls, pass the checkpoint cone and land on the pad in the far corner. ' +
    'The low box on the way is only one box high.',
  widthCm: 400,
  heightCm: 300,
  start: { x: 50, y: 240 },
  startHeadingDeg: 90,
  landingZone: { x: 310, y: 30, width: 60, height: 60 },
  obstacles: [
    { id: 'wall-a', label: 'First box wall', x: 120, y: 0, width: 40, height: 170, heightCm: 100 },
    { id: 'wall-b', label: 'Second box wall', x: 240, y: 130, width: 40, height: 170, heightCm: 100 },
    { id: 'low-box', label: 'Low box', x: 90, y: 220, width: 40, height: 40, heightCm: 40 },
  ],
  noFlyZones: [{ id: 'red-zone', label: 'Red zone', x: 300, y: 180, width: 90, height: 110 }],
  checkpoints: [{ id: 'cone', label: 'Checkpoint cone', x: 200, y: 150, radiusCm: 15 }],
  droneRadiusCm: 8,
  gridSpacingCm: 25,
};
