/**
 * Flies a parsed program (`DroneCommand[]`) on a real CoDrone EDU.
 *
 * The same command list that the simulator checks is sent here, one command
 * at a time: send → wait until the drone reports it is done → next. Timings
 * and control loops follow Robolink's codrone-edu library.
 *
 * Safety:
 *  - preflight: drone answering, Ready on the ground, enough battery, moves within limits;
 *  - any failure (timeout, lost link, missing sensor data) lands the drone;
 *  - `abort()` lands, `emergencyStop()` cuts the motors.
 */
import type { DroneCommand } from '../parser/types';
import {
  CommandType,
  ControlFlightMode,
  DataType,
  DeviceType,
  HeadlessMode,
  commandPacket,
  controlPacket,
  controlPositionPacket,
  landingPacket,
  lostConnectionPacket,
  parseMotionYaw,
  parsePosition,
  parseState,
  requestMotionPacket,
  requestPositionPacket,
  requestStatePacket,
  stopPacket,
  takeOffPacket,
} from './protocol';
import type { DroneStatus, FlightMode, Packet } from './protocol';

/** What the runner needs from the serial link (SerialLink, or a fake in tests). */
export interface DroneLink {
  send(bytes: Uint8Array): Promise<void>;
  onPacket(listener: (packet: Packet) => void): () => void;
}

export const RUNNER_LIMITS = {
  minBattery: 30,
  /** In flight: land when the battery reads below this for LOW_BATTERY_MS (readings sag under load). */
  landBattery: 15,
  /** Longest single move. The protocol allows 10 m; a classroom needs far less. */
  maxMoveCm: 500,
  /** codrone-edu's default move speed (m/s). */
  moveSpeed: 0.5,
  /** codrone-edu's ControlSpeed level set on connect (1–3). */
  speedLevel: 2,
  /** Rotation speed (°/s) when the drone turns itself ('drone-heading'). */
  turnRate: 60,
} as const;

/**
 * How turns are flown:
 * - 'yaw-loop': codrone-edu's turn_direction: yaw stick + heading feedback over the radio.
 *   Overshoots on hardware (each heading reading takes 40–80 ms).
 * - 'drone-heading': one position-control packet with a heading change; the drone's own
 *   flight controller does the turn.
 */
export type TurnMethod = 'yaw-loop' | 'drone-heading';

const STATE_POLL_MS = 250;
/** No reply of any kind for this long = link lost. */
const STATE_STALE_MS = 1500;
/** Give up on a fresh reading (heading, state, position) after this long. */
const FRESH_TIMEOUT_MS = 400;
/** After a turn the drone keeps reporting "Moving" while it steadies; wait this long at most for "Hovering". */
const SETTLE_MS = 2000;
/** Warn when a move covers less than this share of its distance. */
const SHORT_MOVE_RATIO = 0.5;
/**
 * Resend the heading request this often until a reply arrives. Measured on a real
 * controller: 10–25 % of replies are lost, so a single request is not enough.
 */
const FRESH_RETRY_MS = 40;
const TURN_GAIN = 10;
/**
 * Turns end past their target, with either method: measured 2–9°, more on a full battery.
 * The runner learns this as it flies and aims each turn short by its current estimate.
 */
const INITIAL_OVERSHOOT_DEG = 4;
export const DEFAULT_CALIBRATION: Calibration = { overshootDeg: INITIAL_OVERSHOOT_DEG, moveRatio: 1, moveRatioAfterTurn: 1 };
const MAX_OVERSHOOT_DEG = 10;
/**
 * Turns outside this overshoot range (e.g. 111° for 90°, after a radio gap) say nothing about
 * the drone's usual overshoot, so they are not learned from.
 */
const OVERSHOOT_SAMPLE_RANGE = { min: -5, max: 12 } as const;
/** How fast the estimate follows each new measurement (0–1). */
const OVERSHOOT_LEARNING_RATE = 0.25;
/**
 * Replies sometimes stop for a few hundred ms (seen on hardware: heading replies in 2 turns of
 * ~18, position replies at the end of a flight). While the drone is still, waiting is safe, so
 * heading and position readings wait this long; mid-turn, a late heading stops the rotation first.
 */
const HEADING_TIMEOUT_MS = 1200;
/**
 * The link can drop out briefly (seen on hardware: failures while landing, and one flight
 * refused at the start). Landing keeps sending "land" for up to this long, waiting for the
 * drone to confirm, instead of failing after 1.5 s without a reply.
 */
const LAND_CONFIRM_MS = 10_000;
/**
 * The drone's own lost-link behaviour, sent at the start of every flight. Its default was to
 * land only after 20 s without a link, so after a dropout it just hovered (seen on hardware).
 * Now it stops moving after 0.6 s and lands by itself after 3 s.
 */
export const LOST_LINK = { neutralMs: 600, landingMs: 3000, stopMs: 120_000 } as const;
/** After losing contact mid-flight, keep sending "land" this long, waiting for the drone to confirm. */
const LOST_CONTACT_LAND_MS = 30_000;
/** Before refusing to start because the drone isn't answering, wait this long for it to reply. */
const START_CONTACT_MS = 2000;
const TURN_READING_MS = 200;
const LOW_BATTERY_MS = 3000;
/**
 * Moves stop short of their target (measured: 50 cm moves logged 46–51 cm, moves after a turn
 * 5–25 % short). The runner learns the ratio travelled / sent and asks for that much more.
 * It starts at 1 (no assumption) and learns from moves of at least MIN_LEARN_MOVE_CM.
 */
const MIN_LEARN_MOVE_CM = 20;
/**
 * Each move aims at the planned point rather than "asked cm from wherever the drone is", which
 * absorbs drift while hovering and earlier moves' errors. The adjustment is capped, so a bad
 * position reading can't send the drone far off.
 */
const MAX_AIM_ADJUST_CM = 10;
/** Position samples during a move; every 4th request is a State poll instead, so the safety checks keep working. */
const PATH_SAMPLE_MS = 100;
const MOVE_RATIO_LIMITS = { min: 0.75, max: 1.1 } as const;
/** Samples outside this range (a bump, a drift) are not learned from. */
const MOVE_SAMPLE_RANGE = { min: 0.5, max: 1.3 } as const;
const MOVE_LEARNING_RATE = 0.25;
/** Moves that drifted this far off direction are not learned from either. */
const MAX_LEARN_OFF_DEG = 30;

export type RunOutcome =
  | { readonly status: 'COMPLETED' }
  | { readonly status: 'ABORTED' }
  | { readonly status: 'STOPPED' }
  | { readonly status: 'FAILED'; readonly message: string; readonly commandIndex: number | null };

/** What the runner has learned about this drone; saved between sessions (see calibrationStore). */
export interface Calibration {
  /** How far turns end past their target (°). */
  readonly overshootDeg: number;
  /** Distance travelled / distance sent, for moves that don't follow a turn. */
  readonly moveRatio: number;
  /** The same for a move straight after a turn: on hardware these fell ~10 % shorter (Lesson 2: 45 cm vs 52 cm). */
  readonly moveRatioAfterTurn: number;
}

/** One measurement from a real flight, for calibration reports. */
export type Measurement =
  | {
      readonly kind: 'move';
      readonly askedCm: number;
      /** How far this move had to go to reach the planned point (asked, ± adjustments). */
      readonly targetCm: number;
      readonly sentCm: number;
      readonly movedCm: number;
      /** Direction flown vs the line to the planned point (left +). */
      readonly offDeg: number | null;
      /** Largest sideways distance from that line during the move. */
      readonly maxSideCm: number | null;
      /** How the move was adjusted to reach the planned point: further (+) / shorter (−), and left (+) / right (−). */
      readonly adjustAlongCm: number;
      readonly adjustSideCm: number;
      readonly afterTurn: boolean;
    }
  | { readonly kind: 'turn'; readonly askedDeg: number; readonly turnedDeg: number; readonly courseErrorDeg: number }
  /**
   * Where the drone ended, compared with where the program says it should be, just before landing.
   * In the take-off frame: forward + / back −, left + / right −.
   */
  | { readonly kind: 'end'; readonly offCm: number; readonly forwardCm: number; readonly leftCm: number };

export interface RunEvents {
  /** A command starts (index into the list). */
  onStep?(index: number, command: DroneCommand): void;
  onLog?(message: string): void;
  onMeasure?(measurement: Measurement): void;
  /** Something the person flying must know now (e.g. contact lost while the drone may be flying). */
  onWarning?(message: string): void;
}

class Cancelled extends Error {}

interface Report {
  log(message: string): void;
  measure(measurement: Measurement): void;
}

/** How far a move really went, and how far its direction was from the intended one (left +). */
interface MoveReport {
  readonly cm: number;
  /** Direction flown vs the line the program means (left +). */
  readonly offDeg: number | null;
  /** Largest sideways distance from that line during the move (cm), from position samples. */
  readonly maxSideCm: number | null;
}

class FlightError extends Error {}

/** The drone stopped answering mid-flight: it may still be in the air. */
class LostContactError extends FlightError {}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const wrap180 = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;
const airborne = (f: FlightMode | undefined) => f === 'TakeOff' || f === 'Flight' || f === 'Landing';

export class DroneRunner {
  status: DroneStatus | null = null;
  /** Last reply of any kind from the drone. */
  private contactAt = 0;
  /** Latest reply of each data type, with when it arrived. */
  private readonly latest = new Map<number, { readonly at: number; readonly payload: Uint8Array }>();
  private readonly unsubscribe: () => void;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  /**
   * The controller holds one unanswered request at a time, and a newer request
   * replaces it: a State poll landing just after a Motion request means no Motion
   * reply (measured: 0 of 8 answered). So State polling pauses while turning.
   */
  private pollPaused = false;
  private running = false;
  /** Set by abort() / emergencyStop(); checked at every wait. */
  private cancel: 'ABORTED' | 'STOPPED' | null = null;
  private readonly statusListeners = new Set<(s: DroneStatus) => void>();
  /** Both work on hardware; the drone's own heading control doesn't depend on a fast radio loop. */
  turnMethod: TurnMethod = 'drone-heading';
  /** Learned turn overshoot (°). Kept across flights while connected. */
  overshootDeg: number;
  /** Learned distance travelled / distance sent. Kept across flights while connected. */
  moveRatio: number;
  moveRatioAfterTurn: number;
  /** A turn has run since the last move (so the next move uses moveRatioAfterTurn). */
  private turnedSinceMove = false;
  /** When the battery reading first dropped below landBattery (null while above). */
  private lowBatterySince: number | null = null;
  /**
   * How far the drone's heading is from where the program says it should face (left +).
   * Each turn corrects it, so small turn errors don't add up over a program.
   */
  private courseError = 0;
  /**
   * Where the program says the drone should be (cm, in the drone's position frame) and which way it
   * should face, from take-off on. Null when the position couldn't be read at take-off.
   */
  private plan: { x: number; y: number; headingDeg: number } | null = null;
  /** Position samples (metres) collected while a move is tracked; null otherwise. */
  private pathSamples: { x: number; y: number }[] | null = null;

  constructor(
    private readonly link: DroneLink,
    calibration: Calibration = DEFAULT_CALIBRATION,
  ) {
    this.overshootDeg = calibration.overshootDeg;
    this.moveRatio = calibration.moveRatio;
    this.moveRatioAfterTurn = calibration.moveRatioAfterTurn;
    this.unsubscribe = link.onPacket((p) => this.handle(p));
    this.pollTimer = setInterval(() => {
      if (!this.pollPaused) void this.link.send(requestStatePacket()).catch(() => {});
    }, STATE_POLL_MS);
    void this.link.send(requestStatePacket()).catch(() => {});
  }

  get isRunning() {
    return this.running;
  }

  get calibration(): Calibration {
    return { overshootDeg: this.overshootDeg, moveRatio: this.moveRatio, moveRatioAfterTurn: this.moveRatioAfterTurn };
  }

  /** True when the drone has reported its state and replied recently. */
  get isAnswering() {
    return this.status !== null && Date.now() - this.contactAt < STATE_STALE_MS;
  }

  onStatus(listener: (s: DroneStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  dispose() {
    clearInterval(this.pollTimer);
    this.unsubscribe();
  }

  /** Reasons the program can't be flown right now; empty when it can. */
  preflight(commands: readonly DroneCommand[]): string[] {
    const problems: string[] = [];
    if (!this.isAnswering) problems.push('The drone is not answering. Turn it on and check it is paired with the controller.');
    else {
      if (this.status!.flight !== 'Ready') problems.push(`The drone must be sitting ready on the ground (it reports “${this.status!.flight}”).`);
      if (this.status!.battery < RUNNER_LIMITS.minBattery)
        problems.push(`The battery is at ${this.status!.battery}%. Charge it to at least ${RUNNER_LIMITS.minBattery}% before flying.`);
    }
    if (commands[0]?.type !== 'TAKEOFF') problems.push('The program must start with a take off block.');
    commands.forEach((c, i) => {
      if (c.type === 'MOVE' && c.distanceCm > RUNNER_LIMITS.maxMoveCm)
        problems.push(`Block ${i + 1} moves ${c.distanceCm} cm. A real flight allows at most ${RUNNER_LIMITS.maxMoveCm} cm per move.`);
    });
    return problems;
  }

  async run(commands: readonly DroneCommand[], events: RunEvents = {}): Promise<RunOutcome> {
    if (this.running) throw new Error('A flight is already running');
    // A brief gap in replies shouldn't stop a flight before it starts.
    for (const until = Date.now() + START_CONTACT_MS; !this.isAnswering && Date.now() < until; ) await sleep(100);
    const problems = this.preflight(commands);
    if (problems.length > 0) return { status: 'FAILED', message: problems.join(' '), commandIndex: null };

    this.running = true;
    this.cancel = null;
    const log = (m: string) => events.onLog?.(m);
    const report: Report = { log, measure: (m) => events.onMeasure?.(m) };
    let index: number | null = null;
    try {
      await this.setup();
      for (const [i, command] of commands.entries()) {
        index = i;
        events.onStep?.(i, command);
        await this.execute(command, report);
      }
      return { status: 'COMPLETED' };
    } catch (e) {
      if (e instanceof Cancelled) return { status: this.cancel ?? 'ABORTED' };
      let message = e instanceof Error ? e.message : String(e);
      log(`✗ ${message}`);
      if (e instanceof LostContactError) {
        // The drone may still be flying: keep telling it to land until it confirms.
        const warning =
          `Lost contact with the drone. It should land by itself within ${LOST_LINK.landingMs / 1000} seconds. ` +
          'Press STOP if it does not.';
        events.onWarning?.(warning);
        log(`⚠ ${warning}`);
        const landed = await this.landUntilConfirmed();
        message = landed
          ? 'Lost contact with the drone during the flight. It has landed.'
          : 'Lost contact with the drone, and it never confirmed landing. Check that it is down before flying again.';
        log(landed ? '→ the drone has landed' : '✗ landing not confirmed');
      } else if (airborne(this.status?.flight)) {
        log('→ landing for safety');
        await this.land(true).catch(() => {});
      }
      // STOP or abort pressed while it was trying to land.
      if (this.cancel) return { status: this.cancel };
      return { status: 'FAILED', message, commandIndex: index };
    } finally {
      this.running = false;
    }
  }

  /** Ends the flight and lands gently. */
  async abort(): Promise<void> {
    if (this.running) this.cancel = 'ABORTED';
    await this.land(true).catch(() => {});
  }

  /** Cuts the motors at once. The drone drops. */
  async emergencyStop(): Promise<void> {
    if (this.running) this.cancel = 'STOPPED';
    // Repeat: a single packet can be lost over the radio.
    for (let i = 0; i < 5; i++) {
      await this.link.send(stopPacket()).catch(() => {});
      await sleep(20);
    }
  }

  /* ---------- commands ---------- */

  private async execute(command: DroneCommand, { log, measure }: Report) {
    switch (command.type) {
      case 'TAKEOFF':
        log('→ take off');
        return this.takeOff();
      case 'LAND':
        await this.measureEnd({ log, measure });
        log('→ land');
        return this.land(false);
      case 'HOVER':
        log(`→ hover ${command.durationSeconds} s`);
        await this.send(controlPacket(0, 0, 0, 0));
        return this.wait(command.durationSeconds * 1000);
      case 'MOVE': {
        log(`→ ${command.direction.toLowerCase()} ${command.distanceCm} cm`);
        const afterTurn = this.turnedSinceMove;
        this.turnedSinceMove = false;
        const bearings: Record<typeof command.direction, number> = { FORWARD: 0, BACKWARD: 180, LEFT: 90, RIGHT: -90 };
        // Where the program says the drone is now and should end up (take-off frame, cm), if known.
        const from = this.plan;
        this.planMove(command.direction, command.distanceCm);
        const aim = from && this.plan ? { from: { x: from.x, y: from.y }, to: { x: this.plan.x, y: this.plan.y } } : null;
        const ratio = afterTurn ? this.moveRatioAfterTurn : this.moveRatio;
        const result = await this.move(bearings[command.direction], command.distanceCm, aim, ratio, log);
        const moved = result.report;
        if (moved) {
          const short = moved.cm < result.targetCm * SHORT_MOVE_RATIO;
          const target = Math.round(result.targetCm) === command.distanceCm ? '' : `, target ${Math.round(result.targetCm)} cm`;
          const sent = Math.round(result.sentCm) === Math.round(result.targetCm) ? '' : `, sent ${Math.round(result.sentCm)} cm`;
          const off = moved.offDeg === null ? '' : `, ${Math.round(Math.abs(moved.offDeg))}° ${moved.offDeg >= 0 ? 'left' : 'right'} of the line`;
          const side = moved.maxSideCm === null ? '' : `, at most ${Math.round(moved.maxSideCm)} cm off the line`;
          log(`${short ? '⚠ ' : ''}moved ${Math.round(moved.cm)} cm (asked ${command.distanceCm} cm${target}${sent})${off}${side}`);
          this.learnMoveRatio(moved, result.sentCm, afterTurn, log);
          measure({
            kind: 'move',
            askedCm: command.distanceCm,
            targetCm: result.targetCm,
            sentCm: result.sentCm,
            movedCm: moved.cm,
            offDeg: moved.offDeg,
            maxSideCm: moved.maxSideCm,
            adjustAlongCm: result.adjustAlongCm,
            adjustSideCm: result.adjustSideCm,
            afterTurn,
          });
        }
        return;
      }
      case 'TURN': {
        log(`→ turn ${command.direction.toLowerCase()} ${command.degrees}°`);
        const degrees = command.direction === 'LEFT' ? command.degrees : -command.degrees;
        if (this.plan) this.plan = { ...this.plan, headingDeg: this.plan.headingDeg + degrees };
        this.turnedSinceMove = true;
        // Aim at the heading the program expects, not just "degrees from here"...
        const target = Math.max(-360, Math.min(360, degrees - this.courseError));
        // ...and stop short by the overshoot learned so far.
        const sign = Math.sign(target);
        const aim = sign * Math.max(0, Math.abs(target) - this.overshootDeg);
        const turned =
          aim === 0 ? 0 : this.turnMethod === 'drone-heading' ? await this.turnByHeading(aim, log) : await this.turn(aim);
        if (turned === null) {
          this.courseError = 0; // Unknown: start afresh rather than correct by a guess.
          return;
        }
        if (aim !== 0) {
          const observed = sign * turned - Math.abs(aim);
          if (observed < OVERSHOOT_SAMPLE_RANGE.min || observed > OVERSHOOT_SAMPLE_RANGE.max) {
            log(`(unusual turn: not used to learn the overshoot)`);
          } else {
            const next = this.overshootDeg + OVERSHOOT_LEARNING_RATE * (observed - this.overshootDeg);
            this.overshootDeg = Math.max(0, Math.min(MAX_OVERSHOOT_DEG, next));
          }
        }
        this.courseError = wrap180(this.courseError + turned - degrees);
        const wrongWay = turned !== 0 && Math.sign(turned) !== Math.sign(degrees);
        const off = Math.round(Math.abs(this.courseError));
        log(
          `turned ${Math.round(Math.abs(turned))}°${wrongWay ? ' the wrong way' : ''} (asked ${command.degrees}°), ` +
            (off === 0 ? 'on course' : `${off}° ${this.courseError > 0 ? 'left' : 'right'} of course`),
        );
        measure({ kind: 'turn', askedDeg: command.degrees, turnedDeg: Math.abs(turned), courseErrorDeg: this.courseError });
        return;
      }
    }
  }

  /** Same start-up settings codrone-edu applies on connect. */
  private async setup() {
    // If the link drops, the drone lands by itself after a few seconds (see LOST_LINK).
    for (let i = 0; i < 2; i++) {
      await this.send(lostConnectionPacket(LOST_LINK.neutralMs, LOST_LINK.landingMs, LOST_LINK.stopMs));
      await this.wait(30);
    }
    await this.send(commandPacket(CommandType.ControlSpeed, RUNNER_LIMITS.speedLevel));
    for (let i = 0; i < 2; i++) {
      await this.send(commandPacket(CommandType.ModeControlFlight, ControlFlightMode.Position));
      await this.wait(30);
    }
    await this.send(commandPacket(CommandType.Headless, HeadlessMode.Normal));
    await this.hold();
  }

  /** Clears any leftover stick values (codrone-edu's reset_move_values). */
  private async hold() {
    for (let i = 0; i < 3; i++) {
      await this.send(controlPacket(0, 0, 0, 0));
      await this.wait(10);
    }
  }

  private async takeOff() {
    this.courseError = 0;
    this.plan = null;
    this.turnedSinceMove = false;
    await this.hold();
    if (!(await this.sendUntil(takeOffPacket, ['TakeOff', 'Flight'], 4000))) throw new FlightError('The drone did not take off.');
    if (!(await this.waitForFlight(['Flight'], 8000))) throw new FlightError('The drone did not finish climbing.');
    await this.wait(1000);
    // Where the program starts from: the drone's position and heading once it has climbed.
    this.pollPaused = true;
    try {
      const at = await this.freshPosition();
      const heading = await this.tryYaw(HEADING_TIMEOUT_MS);
      if (at && heading !== null) this.plan = { x: at.x * 100, y: at.y * 100, headingDeg: heading };
    } finally {
      this.pollPaused = false;
    }
  }

  /** Moves the planned position by a move as the program asks for it (not as sent or flown). */
  private planMove(direction: 'FORWARD' | 'BACKWARD' | 'LEFT' | 'RIGHT', cm: number) {
    if (!this.plan) return;
    const body: Record<typeof direction, readonly [number, number]> = { FORWARD: [cm, 0], BACKWARD: [-cm, 0], LEFT: [0, cm], RIGHT: [0, -cm] };
    const [bx, by] = body[direction];
    const r = (this.plan.headingDeg * Math.PI) / 180;
    this.plan = { ...this.plan, x: this.plan.x + bx * Math.cos(r) - by * Math.sin(r), y: this.plan.y + bx * Math.sin(r) + by * Math.cos(r) };
  }

  /** Before landing: how far is the drone from where the program says it should be? */
  private async measureEnd({ log, measure }: Report) {
    if (!this.plan) return;
    this.pollPaused = true;
    let at: { x: number; y: number } | null;
    try {
      at = await this.freshPosition();
    } finally {
      this.pollPaused = false;
    }
    if (!at) return;
    const forwardCm = at.x * 100 - this.plan.x;
    const leftCm = at.y * 100 - this.plan.y;
    const offCm = Math.hypot(forwardCm, leftCm);
    const part = (v: number, plus: string, minus: string) => `${Math.round(Math.abs(v))} cm ${v >= 0 ? plus : minus}`;
    log(
      `end point: ${Math.round(offCm)} cm from where the program says ` +
        `(${part(forwardCm, 'further forward', 'further back')}, ${part(leftCm, 'left', 'right')}, as seen from take-off)`,
    );
    measure({ kind: 'end', offCm, forwardCm, leftCm });
  }

  /** `force`: also used to stop a flight, so it ignores cancellation. */
  private async land(force: boolean) {
    if (!force) {
      // A normal landing tolerates short dropouts (see confirmLanding), so it doesn't use wait().
      if (this.cancel) throw new Cancelled();
      await this.link.send(controlPacket(0, 0, 0, 0)).catch(() => {});
      return this.confirmLanding();
    }
    await this.link.send(controlPacket(0, 0, 0, 0)).catch(() => {});
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && !['Landing', 'Ready'].includes(this.status?.flight ?? '')) {
      await this.link.send(landingPacket()).catch(() => {});
      await sleep(100);
    }
  }

  /**
   * After losing contact: keep sending "land" until the drone answers again and reports it is down,
   * for up to LOST_CONTACT_LAND_MS, or until STOP or abort. Returns whether it confirmed.
   */
  private async landUntilConfirmed(): Promise<boolean> {
    const deadline = Date.now() + LOST_CONTACT_LAND_MS;
    let lastSent = 0;
    while (Date.now() < deadline && !this.cancel) {
      if (this.isAnswering && this.status?.flight === 'Ready') return true;
      if (Date.now() - lastSent > 300) {
        await this.link.send(landingPacket()).catch(() => {});
        lastSent = Date.now();
      }
      await sleep(100);
    }
    return this.isAnswering && this.status?.flight === 'Ready';
  }

  /**
   * Waits for the drone to report it has landed, riding out short dropouts: it keeps sending
   * "land" while the drone hasn't confirmed, and only gives up after LAND_CONFIRM_MS.
   */
  private async confirmLanding() {
    const deadline = Date.now() + LAND_CONFIRM_MS;
    let lastSent = 0;
    while (Date.now() < deadline) {
      if (this.cancel) throw new Cancelled();
      const flight = this.isAnswering ? this.status?.flight : undefined;
      if (flight === 'Ready') return;
      if (flight === 'Accident' || flight === 'Error' || flight === 'Stop') throw new FlightError(`The drone reported “${flight}” while landing.`);
      // Not answering, or not landing yet: (re)send "land" now and then.
      if (flight !== 'Landing' && Date.now() - lastSent > 300) {
        await this.link.send(landingPacket()).catch(() => {});
        lastSent = Date.now();
      }
      await sleep(100);
    }
    throw new FlightError(
      this.isAnswering
        ? 'The drone did not report that it landed.'
        : 'Lost contact with the drone while it was landing. Check that it is down before flying again.',
    );
  }

  /**
   * Flies one move. With `aim` (the planned start and end points, take-off frame, cm) it flies from
   * where the drone actually is to the planned end point, so drift while hovering and earlier
   * errors are made up, within MAX_AIM_ADJUST_CM. Without it, it flies `askedCm` at `bearingDeg`
   * from the nose (0 forward, 90 left). The distance sent is the target divided by `ratio`, the
   * learned share of a move the drone actually flies.
   *
   * Seen on hardware: right after a turn the drone still reports "Moving" while it steadies,
   * and a move sent then was skipped (the old code took the leftover "Moving" as the move
   * starting, so it never resent it). So: wait for "Hovering", then resend the move until a
   * fresh state says "Moving".
   *
   * The move is sent relative to the drone's nose, so it is turned into the drone's frame with
   * the measured heading: if the nose is a few degrees off after a turn, the move still follows
   * the planned line. Its position is sampled during the move to measure how far it strays.
   */
  private async move(
    bearingDeg: number,
    askedCm: number,
    aim: { from: { x: number; y: number }; to: { x: number; y: number } } | null,
    ratio: number,
    log: (m: string) => void,
  ): Promise<{ report: MoveReport | null; targetCm: number; sentCm: number; adjustAlongCm: number; adjustSideCm: number }> {
    let start: { x: number; y: number } | null;
    /** Direction to fly, take-off frame (deg, left +); null when the heading is unknown. */
    let lineDeg: number | null = null;
    let targetCm = askedCm;
    let adjustAlongCm = 0;
    let adjustSideCm = 0;
    let bodyDeg = bearingDeg;
    this.pollPaused = true;
    try {
      await this.settle(log);
      start = await this.freshPosition();
      const heading = await this.tryYaw(HEADING_TIMEOUT_MS);
      if (aim && start && heading !== null) {
        // The planned move, and what it takes to get from here to the planned end point.
        const nominal = { x: aim.to.x - aim.from.x, y: aim.to.y - aim.from.y };
        const needed = { x: aim.to.x - start.x * 100, y: aim.to.y - start.y * 100 };
        const len = Math.hypot(nominal.x, nominal.y) || 1;
        const ux = nominal.x / len;
        const uy = nominal.y / len;
        const extra = { x: needed.x - nominal.x, y: needed.y - nominal.y };
        // In the move's own terms: further / shorter, and left / right of the line.
        const along = Math.max(-MAX_AIM_ADJUST_CM, Math.min(MAX_AIM_ADJUST_CM, extra.x * ux + extra.y * uy));
        const sideways = Math.max(-MAX_AIM_ADJUST_CM, Math.min(MAX_AIM_ADJUST_CM, -extra.x * uy + extra.y * ux));
        const flyX = nominal.x + along * ux - sideways * uy;
        const flyY = nominal.y + along * uy + sideways * ux;
        targetCm = Math.hypot(flyX, flyY);
        lineDeg = (Math.atan2(flyY, flyX) * 180) / Math.PI;
        bodyDeg = wrap180(lineDeg - heading);
        adjustAlongCm = along;
        adjustSideCm = sideways;
        if (Math.abs(along) >= 1 || Math.abs(sideways) >= 1) {
          const part = (v: number, plus: string, minus: string) => `${Math.round(Math.abs(v))} cm ${v >= 0 ? plus : minus}`;
          log(`aiming at the planned point: ${part(along, 'further', 'shorter')}, ${part(sideways, 'left', 'right')}`);
        }
      } else if (heading !== null) {
        lineDeg = heading + bearingDeg;
      }
      const sentCm = targetCm / ratio;
      const r = (bodyDeg * Math.PI) / 180;
      const m = sentCm / 100;
      const packet = () => controlPositionPacket(m * Math.cos(r), m * Math.sin(r), 0, RUNNER_LIMITS.moveSpeed);
      await this.sendUntilMoving(packet, 'The drone did not start the move.');
    } finally {
      this.pollPaused = false;
    }
    const sentCm = targetCm / ratio;
    const path = await this.trackPath((sentCm / 100 / RUNNER_LIMITS.moveSpeed) * 1000 + 1000);
    const result = { targetCm, sentCm, adjustAlongCm, adjustSideCm };

    this.pollPaused = true;
    try {
      const end = await this.freshPosition();
      if (!start || !end) return { report: null, ...result };
      const [dx, dy] = [end.x - start.x, end.y - start.y];
      const cm = Math.hypot(dx, dy) * 100;
      const offDeg = lineDeg === null || cm < 3 ? null : wrap180((Math.atan2(dy, dx) * 180) / Math.PI - lineDeg);
      // Sideways distance of each sample (and the end) from the line through the start point.
      let maxSideCm: number | null = null;
      if (lineDeg !== null) {
        const r = (lineDeg * Math.PI) / 180;
        const from = start;
        const side = (p: { x: number; y: number }) => Math.abs(-(p.x - from.x) * Math.sin(r) + (p.y - from.y) * Math.cos(r)) * 100;
        maxSideCm = Math.max(side(end), ...path.map(side));
      }
      return { report: { cm, offDeg, maxSideCm }, ...result };
    } finally {
      this.pollPaused = false;
    }
  }

  /** Samples the drone's position (metres) for `ms`, keeping a State poll every 4th request for the safety checks. */
  private async trackPath(ms: number): Promise<{ x: number; y: number }[]> {
    const samples: { x: number; y: number }[] = [];
    this.pathSamples = samples;
    this.pollPaused = true;
    try {
      const until = Date.now() + ms;
      for (let tick = 0; Date.now() < until; tick++) {
        await this.send(tick % 4 === 3 ? requestStatePacket() : requestPositionPacket());
        await this.wait(Math.min(PATH_SAMPLE_MS, Math.max(0, until - Date.now())));
      }
    } finally {
      this.pathSamples = null;
      this.pollPaused = false;
    }
    return samples;
  }


  private learnMoveRatio(moved: MoveReport, sentCm: number, afterTurn: boolean, log: (m: string) => void) {
    if (sentCm < MIN_LEARN_MOVE_CM || (moved.offDeg !== null && Math.abs(moved.offDeg) > MAX_LEARN_OFF_DEG)) return;
    const sample = moved.cm / sentCm;
    if (sample < MOVE_SAMPLE_RANGE.min || sample > MOVE_SAMPLE_RANGE.max) {
      log('(unusual move: not used to learn the distance)');
      return;
    }
    const learn = (ratio: number) =>
      Math.max(MOVE_RATIO_LIMITS.min, Math.min(MOVE_RATIO_LIMITS.max, ratio + MOVE_LEARNING_RATE * (sample - ratio)));
    if (afterTurn) this.moveRatioAfterTurn = learn(this.moveRatioAfterTurn);
    else this.moveRatio = learn(this.moveRatio);
  }


  /** Waits (State polling paused) until a fresh state says "Hovering"; carries on after SETTLE_MS. */
  private async settle(log: (m: string) => void) {
    const settleBy = Date.now() + SETTLE_MS;
    while ((await this.freshState()).movement !== 'Hovering') {
      if (Date.now() > settleBy) {
        log('⚠ the drone did not settle');
        return;
      }
      await this.wait(100);
    }
  }

  /** Resends a position-control packet until a fresh state says "Moving" (call after settle()). */
  private async sendUntilMoving(packet: () => Uint8Array, failure: string) {
    const deadline = Date.now() + 2000;
    for (;;) {
      await this.send(packet());
      await this.wait(100);
      if ((await this.freshState()).movement === 'Moving') return;
      if (Date.now() > deadline) throw new FlightError(failure);
    }
  }

  /** Signed degrees turned between two headings, unwrapped around the intended turn. */
  private static turned(start: number, end: number, intended: number) {
    return intended + wrap180(end - start - intended);
  }

  /** Measures the heading once the drone has steadied (State polling paused by the caller). */
  private async settledYaw(log: (m: string) => void): Promise<number | null> {
    await this.settle(log);
    const motion = await this.fresh(DataType.Motion, requestMotionPacket, HEADING_TIMEOUT_MS);
    return motion && parseMotionYaw(motion);
  }

  /** Turns with the drone's own heading control. Returns the degrees actually turned (left +). */
  private async turnByHeading(degrees: number, log: (m: string) => void): Promise<number | null> {
    const intended = Math.max(-360, Math.min(360, degrees));
    if (intended === 0) return 0;
    const packet = () => controlPositionPacket(0, 0, 0, RUNNER_LIMITS.moveSpeed, intended, RUNNER_LIMITS.turnRate);
    this.pollPaused = true;
    try {
      await this.settle(log);
      const start = await this.freshYaw();
      await this.sendUntilMoving(packet, 'The drone did not start the turn.');
      const deadline = Date.now() + (Math.abs(intended) / RUNNER_LIMITS.turnRate) * 1000 + 3000;
      while ((await this.freshState()).movement !== 'Hovering') {
        if (Date.now() > deadline) throw new FlightError('The drone did not finish the turn.');
        await this.wait(100);
      }
      const end = await this.settledYaw(log);
      return end === null ? null : DroneRunner.turned(start, end, intended);
    } finally {
      this.pollPaused = false;
    }
  }

  /**
   * Turns by `degrees` (left +) using the yaw angle as feedback, like
   * codrone-edu's turn_direction: a proportional yaw command that slows near the target.
   * Returns the degrees actually turned once the drone has steadied.
   */
  private async turn(degrees: number): Promise<number | null> {
    await this.send(controlPacket(0, 0, 0, 0));
    await this.wait(100);
    const sign = Math.sign(degrees);
    let remaining = Math.min(360, Math.abs(degrees));
    if (remaining < 1) return 0;
    const timeoutMs = remaining > 180 ? 6000 : 3000;

    this.pollPaused = true;
    let start: number | null = null;
    try {
      let prev = await this.freshYaw();
      start = prev;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        let current = await this.tryYaw(TURN_READING_MS);
        if (current === null) {
          // Late reply: stop rotating while waiting, so a radio gap can't turn into an overshoot.
          await this.send(controlPacket(0, 0, 0, 0));
          current = await this.freshYaw();
        }
        // Signed progress, so turning past the target (or the wrong way) can't count as progress.
        remaining -= sign * wrap180(current - prev);
        prev = current;
        if (remaining <= 0) break;
        const power = Math.max(5, Math.min(100, Math.trunc(Math.trunc((remaining / 360) * 100) * TURN_GAIN)));
        await this.send(controlPacket(0, 0, sign * power, 0));
      }
    } finally {
      // Stop rotating whatever happens.
      await this.link.send(controlPacket(0, 0, 0, 0)).catch(() => {});
      this.pollPaused = false;
    }
    // Like codrone-edu, a turn that runs out of time is not an error: carry on from where it got to.
    this.pollPaused = true;
    try {
      const end = await this.settledYaw(() => {});
      return start === null || end === null ? null : DroneRunner.turned(start, end, sign * Math.min(360, Math.abs(degrees)));
    } finally {
      this.pollPaused = false;
    }
  }

  /**
   * Requests `dataType` (resending, since replies get lost) and returns the first reply
   * newer than the request, or null after FRESH_TIMEOUT_MS. Callers pause State polling:
   * the controller holds one pending request, so a poll would replace this one.
   */
  private async fresh(dataType: number, request: () => Uint8Array, timeoutMs = FRESH_TIMEOUT_MS): Promise<Uint8Array | null> {
    const asked = Date.now();
    while (Date.now() - asked < timeoutMs) {
      await this.send(request());
      await this.wait(FRESH_RETRY_MS);
      const reply = this.latest.get(dataType);
      if (reply && reply.at >= asked) return reply.payload;
    }
    return null;
  }

  /** A fresh heading, or null if none arrives within `timeoutMs`. */
  private async tryYaw(timeoutMs: number): Promise<number | null> {
    const payload = await this.fresh(DataType.Motion, requestMotionPacket, timeoutMs);
    return payload && parseMotionYaw(payload);
  }

  private async freshYaw(): Promise<number> {
    const yaw = await this.tryYaw(HEADING_TIMEOUT_MS);
    if (yaw === null) throw new FlightError('The drone stopped sending its heading, so the turn was cancelled.');
    return yaw;
  }

  private async freshState(): Promise<DroneStatus> {
    const payload = await this.fresh(DataType.State, requestStatePacket);
    const state = payload && parseState(payload);
    if (!state) throw new LostContactError('Lost contact with the drone.');
    return state;
  }

  /** Position is only used to report and aim, so a missing reading is not an error. Read while the drone is still. */
  private async freshPosition() {
    const payload = await this.fresh(DataType.Position, requestPositionPacket, HEADING_TIMEOUT_MS);
    return payload && parsePosition(payload);
  }

  /* ---------- plumbing ---------- */

  private handle(packet: Packet) {
    if (packet.from !== DeviceType.Drone) return;
    const now = Date.now();
    this.latest.set(packet.dataType, { at: now, payload: packet.payload });
    this.contactAt = now;
    if (packet.dataType === DataType.Position && this.pathSamples) {
      const p = parsePosition(packet.payload);
      if (p) this.pathSamples.push(p);
    }
    if (packet.dataType === DataType.State) {
      const s = parseState(packet.payload);
      if (!s) return;
      this.status = s;
      this.lowBatterySince = s.battery >= RUNNER_LIMITS.landBattery ? null : (this.lowBatterySince ?? now);
      this.statusListeners.forEach((l) => l(s));
    }
  }

  private async send(bytes: Uint8Array) {
    this.check();
    await this.link.send(bytes);
  }

  /** Sleeps, but wakes early (and throws) on cancellation, lost link or a crash. */
  private async wait(ms: number) {
    const until = Date.now() + ms;
    for (;;) {
      this.check();
      const left = until - Date.now();
      if (left <= 0) return;
      await sleep(Math.min(left, 50));
    }
  }

  private check() {
    if (this.cancel) throw new Cancelled();
    if (!this.isAnswering) throw new LostContactError('Lost contact with the drone.');
    const f = this.status?.flight;
    if (f === 'Accident' || f === 'Error' || f === 'Stop') throw new FlightError(`The drone reported “${f}” and stopped flying.`);
    if (this.lowBatterySince !== null && Date.now() - this.lowBatterySince > LOW_BATTERY_MS && airborne(f))
      throw new FlightError(`The battery is almost empty (${this.status?.battery}%), so the drone landed. Charge it before flying again.`);
  }

  private async sendUntil(packet: () => Uint8Array, modes: FlightMode[], timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await this.send(packet());
      await this.wait(100);
      if (modes.includes(this.status?.flight ?? 'Unknown')) return true;
    }
    return false;
  }

  private async waitForFlight(modes: FlightMode[], timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (modes.includes(this.status?.flight ?? 'Unknown')) return true;
      await this.wait(50);
    }
    return false;
  }
}
