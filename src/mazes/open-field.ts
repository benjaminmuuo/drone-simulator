import type { MazeDefinition } from './types';

/** An empty 4 m × 3 m floor for free practice: land back where you started. */
export const openField: MazeDefinition = {
  id: 'open-field',
  name: 'Open Floor (practice)',
  description: 'No obstacles. Practise moving and turning, then land back on the pad.',
  widthCm: 400,
  heightCm: 300,
  start: { x: 200, y: 150 },
  startHeadingDeg: 0,
  landingZone: { x: 160, y: 110, width: 80, height: 80 },
  obstacles: [],
  noFlyZones: [],
  checkpoints: [],
  droneRadiusCm: 8,
  gridSpacingCm: 25,
};
