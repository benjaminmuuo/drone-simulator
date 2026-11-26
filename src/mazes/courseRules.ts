/**
 * Sizes every course is built to, from flight tests with a real CoDrone EDU
 * (see README, "Flying the real drone"):
 *  - moves land within about ±5 cm, turns within about ±2°; over a whole course
 *    the drone can end up 10–15 cm from where the simulator puts it;
 *  - courses move in whole grid boxes: 44 cm forward (across the width), 60 cm sideways (along the length).
 *    Those accuracy figures were measured on 50 cm moves; re-check them at 60 and 44 cm.
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

/** The real taped floor: 300 cm long and 220 cm wide. The drone starts facing across the width. */
export const ARENA = { widthCm: 300, heightCm: 220 } as const;
export const DRONE_RADIUS_CM = 8;
/** 5 × 5 boxes on that floor: each 60 cm along the length and 44 cm across the width. */
export const GRID = { gridSpacingCm: 60, gridSpacingYCm: 44 } as const;

/** A pad centred on a point. */
export const padAt = (x: number, y: number) => ({ x: x - PAD_CM / 2, y: y - PAD_CM / 2, width: PAD_CM, height: PAD_CM });
