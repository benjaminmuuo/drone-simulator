/**
 * Course layouts used only by engine and 3D tests (no-fly zones, low boxes, walls).
 * They were the app's first two courses; the app now uses Flight School and the maze challenges.
 */
import type { MazeDefinition } from '../../mazes/types';


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
