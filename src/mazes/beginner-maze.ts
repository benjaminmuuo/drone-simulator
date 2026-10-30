import type { MazeDefinition } from './types';

/**
 * 4 m × 3 m classroom course built from cardboard boxes, cones and floor
 * tape. The reference program (main.xml) flies a small U-turn: up 50 cm past
 * the checkpoint cone, 10 cm right, and back down 50 cm onto the landing pad.
 */
export const beginnerMaze: MazeDefinition = {
  id: 'beginner',
  name: 'Beginner Course',
  description:
    'Fly past the checkpoint cone, make a U-turn and land on the pad. Stay clear of the box walls and the taped red zones! ' +
    'The single box is low enough to fly over.',
  widthCm: 400,
  heightCm: 300,
  start: { x: 50, y: 250 },
  startHeadingDeg: 0,
  landingZone: { x: 35, y: 225, width: 50, height: 50 },
  obstacles: [
    { id: 'left-wall', label: 'Box wall', x: 100, y: 110, width: 20, height: 190, heightCm: 100 },
    { id: 'ceiling-block', label: 'Box stack', x: 20, y: 60, width: 70, height: 30, heightCm: 80 },
    { id: 'middle-wall', label: 'Middle box wall', x: 200, y: 140, width: 20, height: 160, heightCm: 100 },
    { id: 'right-pillar', label: 'Box tower', x: 300, y: 60, width: 40, height: 40, heightCm: 100 },
    { id: 'low-box', label: 'Low box', x: 140, y: 200, width: 40, height: 40, heightCm: 40 },
  ],
  noFlyZones: [
    { id: 'red-zone-top', label: 'Red zone', x: 160, y: 20, width: 90, height: 70 },
    { id: 'red-zone-right', label: 'Red zone', x: 300, y: 200, width: 80, height: 80 },
  ],
  checkpoints: [{ id: 'flag', label: 'Checkpoint cone', x: 55, y: 200, radiusCm: 15 }],
  droneRadiusCm: 8,
  gridSpacingCm: 25,
};
