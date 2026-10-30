/**
 * Height a CoDrone EDU holds after takeoff, unless the teacher changes it.
 * Robolink does not publish a fixed takeoff height, so classes should measure
 * their own drones and pick the matching setting.
 */
export const DEFAULT_FLIGHT_HEIGHT_CM = 80;

/** Flight heights offered in the settings. */
export const FLIGHT_HEIGHT_OPTIONS_CM = [40, 50, 60, 70, 80, 90, 100, 120, 150] as const;

/**
 * Safety gap under the drone. A block whose top is closer than this to the
 * drone's flight height counts as a hit (body thickness plus hover wobble).
 */
export const OBSTACLE_CLEARANCE_CM = 10;

/** Height used for obstacles that do not specify one. */
export const DEFAULT_OBSTACLE_HEIGHT_CM = 120;
