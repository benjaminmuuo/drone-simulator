import { programXml } from '../blocks/programXml';
import { ARENA, DRONE_RADIUS_CM, GRID } from './courseRules';
import type { MazeDefinition } from './types';

/** An empty 3 m × 2.2 m floor for free practice: land back where you started. */
export const openField: MazeDefinition = {
  ...ARENA,
  ...GRID,
  id: 'open-field',
  name: 'Open Floor (practice)',
  description: 'No obstacles. Practise moving and turning, then land back on the pad.',
  start: { x: 150, y: 110 },
  startHeadingDeg: 0,
  landingZone: { x: 110, y: 70, width: 80, height: 80 },
  obstacles: [],
  noFlyZones: [],
  checkpoints: [],
  droneRadiusCm: DRONE_RADIUS_CM,
  exampleXml: programXml([['takeoff'], ['hover', 2], ['turn-right', 360], ['land']]),
};
