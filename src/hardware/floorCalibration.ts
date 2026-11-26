import type { DroneCommand } from '../parser/types';

/**
 * What tape-measured test flights found for the real floor (black surface, full battery).
 * Students write real floor distances in their blocks; a real flight translates them with these.
 * The simulator and downloaded programs keep the numbers exactly as written.
 */
export const FLOOR_CALIBRATION = {
  /** The drone lands this many times the distance it is sent (129 cm sent landed at 192 cm on average). */
  distanceScale: 1.49,
  /** Stop a turn this far short of the target: 3.5–3.8° turned 90° (2 of 2), 4.3–4.5° only 86–87° (3 of 3). */
  turnAimShortDeg: 3.5,
  /** Let the drone settle after take-off, and before every turn. */
  takeoffHoverSeconds: 3,
  turnHoverSeconds: 1.5,
} as const;

/** The distance to send so the drone travels `floorCm` on the real floor. */
export const realCm = (floorCm: number) =>
  floorCm > 0 ? Math.max(1, Math.round(floorCm / FLOOR_CALIBRATION.distanceScale)) : 0;

export interface RealFlightPlan {
  /** What the drone is actually told to do. */
  readonly commands: readonly DroneCommand[];
  /** For each of those commands, the index of the student's block it came from. */
  readonly sourceIndex: readonly number[];
}

/** Turns a student's program into the real flight: calibrated distances, plus settling hovers. */
export function toRealFlight(program: readonly DroneCommand[]): RealFlightPlan {
  const { takeoffHoverSeconds, turnHoverSeconds } = FLOOR_CALIBRATION;
  const commands: DroneCommand[] = [];
  const sourceIndex: number[] = [];
  const add = (command: DroneCommand, index: number) => {
    commands.push(command);
    sourceIndex.push(index);
  };

  program.forEach((command, i) => {
    const previous = program[i - 1];
    if (command.type === 'HOVER' && previous?.type === 'TAKEOFF') {
      // The student's own hover after take-off counts towards the settling time.
      add({ ...command, durationSeconds: Math.max(command.durationSeconds, takeoffHoverSeconds) }, i);
      return;
    }
    if (command.type === 'TURN') {
      const settled = previous?.type === 'TAKEOFF' || (previous?.type === 'HOVER' && previous.durationSeconds >= turnHoverSeconds);
      if (!settled) add({ type: 'HOVER', durationSeconds: turnHoverSeconds, blockId: command.blockId }, i);
    }
    add(command.type === 'MOVE' ? { ...command, distanceCm: realCm(command.distanceCm) } : command, i);
    if (command.type === 'TAKEOFF' && program[i + 1]?.type !== 'HOVER')
      add({ type: 'HOVER', durationSeconds: takeoffHoverSeconds, blockId: command.blockId }, i);
  });
  return { commands, sourceIndex };
}
