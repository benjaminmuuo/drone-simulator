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
const MAX_OVERSHOOT_DEG = 15;
/** How fast the estimate follows each new measurement (0–1). */
const OVERSHOOT_LEARNING_RATE = 0.5;
const LOW_BATTERY_MS = 3000;

export type RunOutcome =
  | { readonly status: 'COMPLETED' }
  | { readonly status: 'ABORTED' }
  | { readonly status: 'STOPPED' }
  | { readonly status: 'FAILED'; readonly message: string; readonly commandIndex: number | null };

export interface RunEvents {
  /** A command starts (index into the list). */
  onStep?(index: number, command: DroneCommand): void;
  onLog?(message: string): void;
}

class Cancelled extends Error {}

/** How far a move really went, and how far its direction was from the intended one (left +). */
interface MoveReport {
  readonly cm: number;
  readonly offDeg: number | null;
}

class FlightError extends Error {}

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
  overshootDeg = INITIAL_OVERSHOOT_DEG;
  /** When the battery reading first dropped below landBattery (null while above). */
  private lowBatterySince: number | null = null;
  /**
   * How far the drone's heading is from where the program says it should face (left +).
   * Each turn corrects it, so small turn errors don't add up over a program.
   */
  private courseError = 0;

  constructor(private readonly link: DroneLink) {
    this.unsubscribe = link.onPacket((p) => this.handle(p));
    this.pollTimer = setInterval(() => {
      if (!this.pollPaused) void this.link.send(requestStatePacket()).catch(() => {});
    }, STATE_POLL_MS);
    void this.link.send(requestStatePacket()).catch(() => {});
  }

  get isRunning() {
    return this.running;
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
    const problems = this.preflight(commands);
    if (problems.length > 0) return { status: 'FAILED', message: problems.join(' '), commandIndex: null };

    this.running = true;
    this.cancel = null;
    const log = (m: string) => events.onLog?.(m);
    let index: number | null = null;
    try {
      await this.setup();
      for (const [i, command] of commands.entries()) {
        index = i;
        events.onStep?.(i, command);
        await this.execute(command, log);
      }
      return { status: 'COMPLETED' };
    } catch (e) {
      if (e instanceof Cancelled) return { status: this.cancel ?? 'ABORTED' };
      const message = e instanceof Error ? e.message : String(e);
      log(`✗ ${message}`);
      if (airborne(this.status?.flight)) {
        log('→ landing for safety');
        await this.land(true).catch(() => {});
      }
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

  private async execute(command: DroneCommand, log: (m: string) => void) {
    switch (command.type) {
      case 'TAKEOFF':
        log('→ take off');
        return this.takeOff();
      case 'LAND':
        log('→ land');
        return this.land(false);
      case 'HOVER':
        log(`→ hover ${command.durationSeconds} s`);
        await this.send(controlPacket(0, 0, 0, 0));
        return this.wait(command.durationSeconds * 1000);
      case 'MOVE': {
        log(`→ ${command.direction.toLowerCase()} ${command.distanceCm} cm`);
        const m = command.distanceCm / 100;
        const axes: Record<typeof command.direction, readonly [number, number]> = {
          FORWARD: [m, 0],
          BACKWARD: [-m, 0],
          LEFT: [0, m],
          RIGHT: [0, -m],
        };
        const [x, y] = axes[command.direction];
        const moved = await this.move(x, y, m, log);
        if (moved) {
          const short = moved.cm < command.distanceCm * SHORT_MOVE_RATIO;
          const off = moved.offDeg === null ? '' : `, ${Math.round(Math.abs(moved.offDeg))}° ${moved.offDeg >= 0 ? 'left' : 'right'} of the expected direction`;
          log(`${short ? '⚠ ' : ''}moved ${Math.round(moved.cm)} cm (asked ${command.distanceCm} cm)${off}`);
        }
        return;
      }
      case 'TURN': {
        log(`→ turn ${command.direction.toLowerCase()} ${command.degrees}°`);
        const degrees = command.direction === 'LEFT' ? command.degrees : -command.degrees;
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
          const next = this.overshootDeg + OVERSHOOT_LEARNING_RATE * (observed - this.overshootDeg);
          this.overshootDeg = Math.max(0, Math.min(MAX_OVERSHOOT_DEG, next));
        }
        this.courseError = wrap180(this.courseError + turned - degrees);
        const wrongWay = turned !== 0 && Math.sign(turned) !== Math.sign(degrees);
        const off = Math.round(Math.abs(this.courseError));
        log(
          `turned ${Math.round(Math.abs(turned))}°${wrongWay ? ' the wrong way' : ''} (asked ${command.degrees}°), ` +
            (off === 0 ? 'on course' : `${off}° ${this.courseError > 0 ? 'left' : 'right'} of course`),
        );
        return;
      }
    }
  }

  /** Same start-up settings codrone-edu applies on connect. */
  private async setup() {
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
    await this.hold();
    if (!(await this.sendUntil(takeOffPacket, ['TakeOff', 'Flight'], 4000))) throw new FlightError('The drone did not take off.');
    if (!(await this.waitForFlight(['Flight'], 8000))) throw new FlightError('The drone did not finish climbing.');
    await this.wait(1000);
  }

  /** `force`: also used to stop a flight, so it ignores cancellation. */
  private async land(force: boolean) {
    const send = (b: Uint8Array) => (force ? this.link.send(b) : this.send(b));
    await send(controlPacket(0, 0, 0, 0));
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && !['Landing', 'Ready'].includes(this.status?.flight ?? '')) {
      await send(landingPacket());
      await (force ? sleep(100) : this.wait(100));
    }
    if (force) return;
    if (!(await this.waitForFlight(['Ready'], 8000))) throw new FlightError('The drone did not report that it landed.');
  }

  /**
   * Moves relative to the drone's heading. Returns the distance actually travelled (cm),
   * or null when the position could not be read.
   *
   * Seen on hardware: right after a turn the drone still reports "Moving" while it steadies,
   * and a move sent then was skipped (the old code took the leftover "Moving" as the move
   * starting, so it never resent it). So: wait for "Hovering", then resend the move until a
   * fresh state says "Moving".
   */
  private async move(x: number, y: number, distanceM: number, log: (m: string) => void): Promise<MoveReport | null> {
    const packet = () => controlPositionPacket(x, y, 0, RUNNER_LIMITS.moveSpeed);
    let start: { x: number; y: number } | null;
    let heading: number | null;
    this.pollPaused = true;
    try {
      await this.settle(log);
      start = await this.freshPosition();
      const motion = await this.fresh(DataType.Motion, requestMotionPacket);
      heading = motion && parseMotionYaw(motion);
      await this.sendUntilMoving(packet, 'The drone did not start the move.');
    } finally {
      this.pollPaused = false;
    }
    await this.wait((distanceM / RUNNER_LIMITS.moveSpeed) * 1000 + 1000);

    this.pollPaused = true;
    try {
      const end = await this.freshPosition();
      if (!start || !end) return null;
      const [dx, dy] = [end.x - start.x, end.y - start.y];
      const cm = Math.hypot(dx, dy) * 100;
      // Position and heading share the take-off frame (left +), so a move along the drone's
      // nose should point at heading + the move's own bearing.
      const expected = heading === null ? null : heading + (Math.atan2(y, x) * 180) / Math.PI;
      const offDeg = expected === null || cm < 3 ? null : wrap180((Math.atan2(dy, dx) * 180) / Math.PI - expected);
      return { cm, offDeg };
    } finally {
      this.pollPaused = false;
    }
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
    const motion = await this.fresh(DataType.Motion, requestMotionPacket);
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
        const current = await this.freshYaw();
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
  private async fresh(dataType: number, request: () => Uint8Array): Promise<Uint8Array | null> {
    const asked = Date.now();
    while (Date.now() - asked < FRESH_TIMEOUT_MS) {
      await this.send(request());
      await this.wait(FRESH_RETRY_MS);
      const reply = this.latest.get(dataType);
      if (reply && reply.at >= asked) return reply.payload;
    }
    return null;
  }

  private async freshYaw(): Promise<number> {
    const payload = await this.fresh(DataType.Motion, requestMotionPacket);
    const yaw = payload && parseMotionYaw(payload);
    if (yaw === null || yaw === undefined) throw new FlightError('The drone stopped sending its heading, so the turn was cancelled.');
    return yaw;
  }

  private async freshState(): Promise<DroneStatus> {
    const payload = await this.fresh(DataType.State, requestStatePacket);
    const state = payload && parseState(payload);
    if (!state) throw new FlightError('Lost contact with the drone.');
    return state;
  }

  /** Position is only used to report distances, so a missing reading is not an error. */
  private async freshPosition() {
    const payload = await this.fresh(DataType.Position, requestPositionPacket);
    return payload && parsePosition(payload);
  }

  /* ---------- plumbing ---------- */

  private handle(packet: Packet) {
    if (packet.from !== DeviceType.Drone) return;
    const now = Date.now();
    this.latest.set(packet.dataType, { at: now, payload: packet.payload });
    this.contactAt = now;
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
    if (!this.isAnswering) throw new FlightError('Lost contact with the drone.');
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
