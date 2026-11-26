/**
 * Deterministic, framework-independent flight simulation.
 *
 * Commands are applied one at a time to an authoritative DroneState. A rejected
 * command leaves the state untouched and stops the run. Animation code only
 * ever reads the results produced here.
 */
import { describeCommand } from '../parser/describeCommand';
import type { DroneCommand } from '../parser/types';
import { coneBase, conesOf } from '../mazes/cones';
import { DEFAULT_FLIGHT_HEIGHT_CM, FLIGHT_HEIGHT_LIMITS_CM } from '../mazes/constants';
import type { MazeDefinition, Point } from '../mazes/types';
import { blocksFlight, checkPath, circleOverlapsRect, pointSegmentDistance, rectContainsPoint } from './CollisionDetector';
import { moveTarget, normalizeHeading, turnHeading } from './MovementEngine';
import type { DroneState, SimulationFailure, SimulationResult, StepResult } from './types';

export interface SimulationOptions {
  /** Height the drone holds after takeoff; lower obstacles can be flown over. */
  readonly flightHeightCm?: number;
}

export function initialState(maze: MazeDefinition): DroneState {
  return { x: maze.start.x, y: maze.start.y, headingDeg: normalizeHeading(maze.startHeadingDeg), flight: 'LANDED', heightCm: 0 };
}

function stepLabel(index: number, command: DroneCommand): string {
  return `Step ${index + 1} (${describeCommand(command)})`;
}

export class SimulationEngine {
  private state: DroneState;
  private readonly visited = new Set<string>();
  private readonly flightHeightCm: number;
  /** Blocks between the first Take off and the last Land, counted on the last run. */
  private blocksBetween = 0;

  constructor(
    private readonly maze: MazeDefinition,
    options: SimulationOptions = {},
  ) {
    this.state = initialState(maze);
    this.flightHeightCm = options.flightHeightCm ?? DEFAULT_FLIGHT_HEIGHT_CM;
  }

  getState(): DroneState {
    return this.state;
  }

  getVisitedCheckpoints(): string[] {
    return this.maze.checkpoints.filter((cp) => this.visited.has(cp.id)).map((cp) => cp.id);
  }

  reset(): void {
    this.state = initialState(this.maze);
    this.visited.clear();
  }

  /** Applies one command. On failure the state is left unchanged. */
  execute(command: DroneCommand, index: number): StepResult {
    const before = this.state;
    const fail = (failure: Omit<SimulationFailure, 'commandIndex' | 'blockId'>): StepResult => ({
      index,
      command,
      before,
      after: before,
      failure: { ...failure, commandIndex: index, blockId: command.blockId },
      checkpointsCollected: [],
    });
    const label = stepLabel(index, command);

    if (command.type === 'TAKEOFF') {
      if (before.flight === 'FLYING') {
        return fail({ kind: 'ALREADY_FLYING', message: `${label}: the drone is already flying, so it cannot take off again.` });
      }
    } else if (before.flight !== 'FLYING') {
      const message =
        command.type === 'LAND'
          ? `${label}: the drone is not flying, so it cannot land.`
          : `${label}: the drone must take off before it can ${command.type === 'HOVER' ? 'hover' : command.type === 'TURN' ? 'turn' : command.type === 'VERTICAL' ? `go ${command.direction.toLowerCase()}` : 'move'}.`;
      return fail({ kind: 'NOT_FLYING', message });
    }

    let after: DroneState = before;
    let collected: string[] = [];

    switch (command.type) {
      case 'TAKEOFF':
        after = { ...before, flight: 'FLYING', heightCm: this.flightHeightCm };
        collected = this.collect(before, before);
        break;
      case 'LAND': {
        // A low box the drone flew over is still in the way when it comes down.
        const box = this.maze.obstacles.find((o) => circleOverlapsRect(before, this.maze.droneRadiusCm, o));
        if (box) {
          return fail({
            kind: 'COLLISION_OBSTACLE',
            message: `${label}: the drone would land on top of "${box.label}".`,
            contactPoint: { x: before.x, y: before.y },
            zoneId: box.id,
          });
        }
        // Cones are flown over, but coming down on one tips the drone over.
        const cone = conesOf(this.maze).find((c) => circleOverlapsRect(before, this.maze.droneRadiusCm, coneBase(c)));
        if (cone) {
          return fail({
            kind: 'LANDED_ON_CONE',
            message:
              `${label}: the drone would land on the ${cone.label}. ` +
              'A cone is not a safe place to land: the drone could tip over or break a propeller.',
            contactPoint: { x: cone.x, y: cone.y },
          });
        }
        after = { ...before, flight: 'LANDED', heightCm: 0 };
        break;
      }
      case 'VERTICAL': {
        const { min, max } = FLIGHT_HEIGHT_LIMITS_CM;
        const heightCm = before.heightCm + (command.direction === 'UP' ? command.distanceCm : -command.distanceCm);
        if (heightCm > max) {
          return fail({
            kind: 'TOO_HIGH',
            message: `${label}: the drone would be ${heightCm} cm high, above the class limit of ${max} cm. Go up less.`,
          });
        }
        if (heightCm < min) {
          return fail({
            kind: 'TOO_LOW',
            message: `${label}: the drone would be ${heightCm} cm high, too close to the floor (lowest ${min} cm). Go down less, or use Land to come down.`,
          });
        }
        // Coming down onto a box the drone was flying over.
        const box = this.maze.obstacles.find(
          (o) => blocksFlight(o, heightCm) && circleOverlapsRect(before, this.maze.droneRadiusCm, o),
        );
        if (box) {
          return fail({
            kind: 'COLLISION_OBSTACLE',
            message: `${label}: the drone would come down onto "${box.label}".`,
            contactPoint: { x: before.x, y: before.y },
            zoneId: box.id,
          });
        }
        after = { ...before, heightCm };
        break;
      }
      case 'HOVER':
        // Position and heading are preserved; the duration only affects playback.
        break;
      case 'TURN':
        after = { ...before, headingDeg: turnHeading(before.headingDeg, command.direction, command.degrees) };
        break;
      case 'MOVE': {
        const target = moveTarget(before, before.headingDeg, command.direction, command.distanceCm);
        const hit = checkPath(this.maze, before, target, before.heightCm);
        if (hit) {
          const where = hit.zoneLabel ? ` "${hit.zoneLabel}"` : '';
          const message =
            hit.kind === 'COLLISION_OBSTACLE'
              ? `${label}: the drone would crash into the obstacle${where}.`
              : hit.kind === 'NO_FLY_ZONE'
                ? `${label}: the drone would enter the red no-fly zone${where}.`
                : `${label}: the drone would fly out of the arena.`;
          return fail({
            kind: hit.kind,
            message,
            contactPoint: hit.contactPoint,
            ...(hit.zoneId !== undefined ? { zoneId: hit.zoneId } : {}),
          });
        }
        after = { ...before, x: target.x, y: target.y };
        collected = this.collect(before, target);
        break;
      }
    }

    this.state = after;
    return { index, command, before, after, failure: null, checkpointsCollected: collected };
  }

  private collect(from: Point, to: Point): string[] {
    const collected: string[] = [];
    for (const cp of this.maze.checkpoints) {
      if (!this.visited.has(cp.id) && pointSegmentDistance(cp, from, to) <= cp.radiusCm) {
        this.visited.add(cp.id);
        collected.push(cp.id);
      }
    }
    return collected;
  }

  /** Mission checks applied once every command has run successfully. */
  private finalFailure(): SimulationFailure | null {
    const end = (kind: SimulationFailure['kind'], message: string): SimulationFailure => ({
      kind,
      message,
      commandIndex: null,
      blockId: null,
    });
    if (this.state.flight === 'FLYING') {
      return end('NOT_LANDED', 'The program finished while the drone was still in the air. Add a Land block at the end.');
    }
    const limit = this.maze.maxBlocksBetween;
    if (limit !== undefined && this.blocksBetween > limit) {
      return end(
        'TOO_MANY_BLOCKS',
        `Your move has ${this.blocksBetween} blocks between Take off and Land. The rule is at most ${limit}: take some out.`,
      );
    }
    if (!rectContainsPoint(this.maze.landingZone, this.state)) {
      return end('LANDED_OUTSIDE_ZONE', 'The drone landed safely, but not inside the green landing zone.');
    }
    const missed = this.maze.checkpoints.filter((cp) => !this.visited.has(cp.id));
    if (missed.length > 0) {
      return end('CHECKPOINT_MISSED', `The drone landed, but missed: ${missed.map((cp) => cp.label).join(', ')}.`);
    }
    const facing = this.maze.endHeadingDeg;
    if (facing !== undefined && normalizeHeading(this.state.headingDeg) !== normalizeHeading(facing)) {
      const off = normalizeHeading(this.state.headingDeg - facing);
      const side = off <= 180 ? `${off}° to the right` : `${360 - off}° to the left`;
      return end(
        'WRONG_HEADING',
        `The drone landed on the pad, but turned ${side} of the way it should face. Add or change a turn so it ends facing the way it started.`,
      );
    }
    return null;
  }

  /** Resets, then runs the whole program, stopping at the first failure. */
  run(commands: readonly DroneCommand[]): SimulationResult {
    this.reset();
    this.blocksBetween = countBlocksBetween(commands);
    const steps: StepResult[] = [];
    let failure: SimulationFailure | null = null;

    if (commands.length === 0) {
      failure = { kind: 'EMPTY_PROGRAM', message: 'There are no commands to run.', commandIndex: null, blockId: null };
    }
    for (const [index, command] of commands.entries()) {
      if (failure) break;
      const step = this.execute(command, index);
      steps.push(step);
      failure = step.failure;
    }
    failure ??= this.finalFailure();

    return {
      status: failure ? 'FAILED' : 'SUCCESS',
      steps,
      finalState: this.state,
      failure,
      checkpointsVisited: this.getVisitedCheckpoints(),
    };
  }
}

/**
 * Blocks between the first Take off and the last Land, as the student placed them: a block
 * inside a loop counts once however many times it runs (the loop block itself isn't counted).
 */
export function countBlocksBetween(commands: readonly DroneCommand[]): number {
  const first = commands.findIndex((c) => c.type === 'TAKEOFF');
  let last = -1;
  commands.forEach((c, i) => {
    if (c.type === 'LAND') last = i;
  });
  if (first < 0 || last <= first) return 0;
  const seen = new Set<string>();
  let anonymous = 0;
  for (const c of commands.slice(first + 1, last)) {
    if (c.blockId === null) anonymous++;
    else seen.add(c.blockId);
  }
  return seen.size + anonymous;
}

export function simulate(
  commands: readonly DroneCommand[],
  maze: MazeDefinition,
  options: SimulationOptions = {},
): SimulationResult {
  return new SimulationEngine(maze, options).run(commands);
}
