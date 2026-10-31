/**
 * Sizes every course is built to, from flight tests with a real CoDrone EDU
 * (see README, "Flying the real drone"):
 *  - moves land within about ±5 cm, turns within about ±2°; over a whole course
 *    the drone can end up 10–15 cm from where the simulator puts it;
 *  - 50 cm moves were the most tested, so courses use multiples of 50 cm.
 */

/** Landing pads: 50 × 50 cm, so the drone has ±25 cm to land on target. */
export const PAD_CM = 50;

/** Cardboard boxes are about 40 cm on each side; walls are 3 boxes high (taller than any flight height up to 110 cm). */
export const BOX_CM = 40;
export const WALL_HEIGHT_CM = 120;
/** Two boxes: taller than flight height − 10 cm at the default 80 cm, so the drone can't fly over. */
export const STACK_HEIGHT_CM = 80;

/**
 * The example route keeps at least this far (drone centre to the face of a tall obstacle):
 * drone radius 8 cm + up to ~15 cm of drift + margin.
 */
export const MIN_PATH_CLEARANCE_CM = 40;

export const ARENA = { widthCm: 400, heightCm: 300 } as const;
export const DRONE_RADIUS_CM = 8;
export const GRID_CM = 25;

/** A pad centred on a point. */
export const padAt = (x: number, y: number) => ({ x: x - PAD_CM / 2, y: y - PAD_CM / 2, width: PAD_CM, height: PAD_CM });
