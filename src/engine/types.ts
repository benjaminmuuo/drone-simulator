import type { DroneCommand } from '../parser/types';
import type { Point } from '../mazes/types';

export type FlightState = 'LANDED' | 'FLYING';

/** Authoritative drone state. Never mutated by animation. */
export interface DroneState {
  readonly x: number;
  readonly y: number;
  /** Normalised to [0, 360). 0 = up, 90 = right. */
  readonly headingDeg: number;
  readonly flight: FlightState;
}

export type FailureKind =
  | 'COLLISION_OBSTACLE'
  | 'NO_FLY_ZONE'
  | 'OUT_OF_BOUNDS'
  | 'NOT_FLYING'
  | 'ALREADY_FLYING'
  | 'NOT_LANDED'
  | 'LANDED_OUTSIDE_ZONE'
  | 'CHECKPOINT_MISSED'
  | 'EMPTY_PROGRAM';

export interface SimulationFailure {
  readonly kind: FailureKind;
  readonly message: string;
  /** Index into the command list, or null for end-of-mission checks. */
  readonly commandIndex: number | null;
  readonly blockId: string | null;
  /** Obstacle / zone id involved, when relevant. */
  readonly zoneId?: string;
  /** Where the drone would first have touched the obstacle (for display only). */
  readonly contactPoint?: Point;
}

export interface StepResult {
  readonly index: number;
  readonly command: DroneCommand;
  readonly before: DroneState;
  /** Equal to `before` when the command was rejected. */
  readonly after: DroneState;
  readonly failure: SimulationFailure | null;
  /** Checkpoint ids first collected during this step. */
  readonly checkpointsCollected: readonly string[];
}

export type MissionStatus = 'SUCCESS' | 'FAILED';

export interface SimulationResult {
  readonly status: MissionStatus;
  readonly steps: readonly StepResult[];
  readonly finalState: DroneState;
  readonly failure: SimulationFailure | null;
  readonly checkpointsVisited: readonly string[];
}
