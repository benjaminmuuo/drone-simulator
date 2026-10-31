import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DroneRunner, RUNNER_LIMITS } from '../hardware/DroneRunner';
import { parseRobolinkXml } from '../parser/RobolinkXmlParser';
import { EXAMPLE_PROGRAM_XML } from '../blocks/robolinkBlocks';
import type { DroneCommand } from '../parser/types';
import { FLIGHT, FakeDrone } from './fakeDrone';

function parse(xml: string): readonly DroneCommand[] {
  const r = parseRobolinkXml(xml);
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('; '));
  return r.commands;
}

const cmd = {
  takeoff: { type: 'TAKEOFF', blockId: 'a' },
  land: { type: 'LAND', blockId: 'z' },
  hover: (s: number): DroneCommand => ({ type: 'HOVER', durationSeconds: s, blockId: 'h' }),
  forward: (cm: number): DroneCommand => ({ type: 'MOVE', direction: 'FORWARD', distanceCm: cm, blockId: 'm' }),
  turn: (direction: 'LEFT' | 'RIGHT', degrees: number): DroneCommand => ({ type: 'TURN', direction, degrees, blockId: 't' }),
} as const satisfies Record<string, DroneCommand | ((...args: never[]) => DroneCommand)>;

/** Advances fake time until the promise settles. */
async function settle<T>(promise: Promise<T>, maxMs = 120_000): Promise<T> {
  let done = false;
  let value: T;
  promise.then((v) => {
    done = true;
    value = v;
  });
  for (let t = 0; !done && t < maxMs; t += 50) await vi.advanceTimersByTimeAsync(50);
  if (!done) throw new Error('Timed out');
  return value!;
}

let drone: FakeDrone;
let runner: DroneRunner;

beforeEach(async () => {
  vi.useFakeTimers();
  drone = new FakeDrone();
  runner = new DroneRunner(drone);
  await vi.advanceTimersByTimeAsync(300);
});

afterEach(() => {
  runner.dispose();
  vi.useRealTimers();
});

describe('DroneRunner', () => {
  it('flies the reference U-turn program in order and lands', async () => {
    const steps: number[] = [];
    const outcome = await settle(runner.run(parse(EXAMPLE_PROGRAM_XML), { onStep: (i) => steps.push(i) }));

    expect(outcome).toEqual({ status: 'COMPLETED' });
    expect(steps).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(drone.events.filter((e) => !e.startsWith('TURN'))).toEqual(['TAKEOFF', 'MOVE 0.50,0.00', 'MOVE 0.10,0.00', 'MOVE 0.50,0.00', 'LAND']);
    // Turns are flown by the drone's own heading control by default.
    expect(drone.turns).toHaveLength(2);
    expect(drone.flight).toBe(FLIGHT.Ready);
    // Two right turns of 90° → about -180° (left is +).
    expect(Math.abs(drone.yaw)).toBeGreaterThan(150);
  });

  it('waits for the drone to steady after a turn, so the next move is not skipped', async () => {
    const log: string[] = [];
    await settle(runner.run(parse(EXAMPLE_PROGRAM_XML), { onLog: (m) => log.push(m) }));
    // 50 forward, turn right, 10 forward, turn right, 50 forward: a U-turn 10 cm to the right.
    expect(drone.moves).toHaveLength(3);
    expect(drone.x).toBeCloseTo(0, 1);
    expect(Math.abs(drone.y)).toBeGreaterThan(0.05);
    expect(log.filter((m) => m.startsWith('moved')).map((m) => m.replace(/, \d+° (left|right) of/, ', N° of'))).toEqual([
      'moved 50 cm (asked 50 cm), N° of the expected direction',
      'moved 10 cm (asked 10 cm), N° of the expected direction',
      'moved 50 cm (asked 50 cm), N° of the expected direction',
    ]);
    // Moves follow the nose, so every direction error is small.
    for (const m of log.filter((l) => l.startsWith('moved'))) expect(Number(/(\d+)°/.exec(m)![1])).toBeLessThan(15);
  });

  it('warns when a move falls short', async () => {
    const log: string[] = [];
    drone.settleMs = 0;
    const run = runner.run([cmd.takeoff, cmd.forward(50), cmd.land], { onLog: (m) => log.push(m) });
    // Knock the drone back mid-move (as if it hit something soft).
    await vi.advanceTimersByTimeAsync(4500);
    drone.x -= 0.4;
    await settle(run);
    expect(log).toContainEqual(expect.stringMatching(/^⚠ moved \d+ cm \(asked 50 cm\)/));
  });

  it('reports how far a turn really went, including overshoot', async () => {
    runner.turnMethod = 'yaw-loop';
    drone.overshootDeg = 15;
    const log: string[] = [];
    await settle(runner.run([cmd.takeoff, cmd.turn('RIGHT', 90), cmd.land], { onLog: (m) => log.push(m) }));
    const line = log.find((m) => m.startsWith('turned'))!;
    expect(Number(/turned (\d+)°/.exec(line)![1])).toBeGreaterThan(100);
    expect(line).toMatch(/\(asked 90°\), \d+° right of course$/);
  });

  it('corrects turn errors on the next turn, so they do not add up', async () => {
    runner.turnMethod = 'yaw-loop';
    // Overshoot more than the stopping margin allows for, so every turn ends ~5° too far.
    drone.overshootDeg = 8;
    const log: string[] = [];
    await settle(runner.run(parse(EXAMPLE_PROGRAM_XML), { onLog: (m) => log.push(m) }));
    const turned = log.filter((m) => m.startsWith('turned')).map((m) => Number(/turned (\d+)°/.exec(m)![1]));
    expect(turned).toHaveLength(2);
    // The second turn is smaller, making up for the first one's overshoot...
    expect(turned[1]!).toBeLessThan(turned[0]! - 2);
    // ...so the drone ends up facing back with one turn's error, not two (190°).
    expect(Math.abs(180 - Math.abs(drone.yaw))).toBeLessThan(7);
  });

  it('turns with the drone heading control, aiming short by the learned overshoot', async () => {
    // Like the hardware: the drone ends ~5° past its target.
    drone.overshootDeg = 5;
    const log: string[] = [];
    const outcome = await settle(runner.run(parse(EXAMPLE_PROGRAM_XML), { onLog: (m) => log.push(m) }));
    expect(outcome).toEqual({ status: 'COMPLETED' });
    // Aimed short (starting estimate 4°), then shorter once it learned the drone overshoots ~5°.
    expect(drone.turns[0]).toBe(-86);
    expect(Math.abs(drone.turns[1]!)).toBeLessThan(86);
    for (const line of log.filter((m) => m.startsWith('turned'))) expect(line).toMatch(/(on course|[0-2]° (left|right) of course)$/);
    // Learning is gradual: the estimate moves from 4° towards the drone's 5°.
    expect(runner.overshootDeg).toBeGreaterThan(4.2);
    // Same end point as planned: back level with the start, 10 cm to the right.
    expect(drone.x).toBeCloseTo(0, 1);
    expect(drone.y).toBeCloseTo(-0.1, 1);
  });

  it('learns how short moves fall and asks for more', async () => {
    // Like the hardware: the drone travels ~90 % of each move.
    drone.travelRatio = 0.9;
    const moved = (log: string[]) => log.filter((m) => m.startsWith('moved')).map((m) => Number(/moved (\d+) cm/.exec(m)![1]));
    const first: string[] = [];
    await settle(runner.run(parse(EXAMPLE_PROGRAM_XML), { onLog: (m) => first.push(m) }));
    expect(moved(first)[0]).toBe(45);
    for (let flight = 0; flight < 2; flight++) await settle(runner.run(parse(EXAMPLE_PROGRAM_XML)));
    const last: string[] = [];
    await settle(runner.run(parse(EXAMPLE_PROGRAM_XML), { onLog: (m) => last.push(m) }));
    // A few flights later the 50 cm moves come out at ~49 cm, because it sends ~54 cm.
    expect(moved(last)[0]).toBeGreaterThanOrEqual(48);
    expect(last.find((m) => m.startsWith('moved'))).toMatch(/\(asked 50 cm, sent 5[3-6] cm\)/);
    expect(runner.moveRatio).toBeGreaterThan(0.9);
    expect(runner.moveRatio).toBeLessThan(0.95);
  });

  it('does not learn distances from an unusual move', async () => {
    drone.travelRatio = 0.3;
    const log: string[] = [];
    await settle(runner.run([cmd.takeoff, cmd.forward(50), cmd.land], { onLog: (m) => log.push(m) }));
    expect(log).toContain('(unusual move: not used to learn the distance)');
    expect(runner.moveRatio).toBe(1);
  });

  it('does not learn from an unusual turn', async () => {
    drone.overshootDeg = 25;
    const log: string[] = [];
    await settle(runner.run([cmd.takeoff, cmd.turn('RIGHT', 90), cmd.land], { onLog: (m) => log.push(m) }));
    expect(log).toContain('(unusual turn: not used to learn the overshoot)');
    expect(runner.overshootDeg).toBe(4);
  });

  it('rides out a gap in heading replies mid-turn without overshooting', async () => {
    runner.turnMethod = 'yaw-loop';
    const run = runner.run([cmd.takeoff, cmd.turn('RIGHT', 90), cmd.land]);
    // Take-off and the start of the turn, then ~0.7 s with no heading replies.
    await vi.advanceTimersByTimeAsync(4700);
    drone.answerMotion = false;
    await vi.advanceTimersByTimeAsync(700);
    drone.answerMotion = true;
    expect(await settle(run)).toEqual({ status: 'COMPLETED' });
    expect(drone.yaw).toBeLessThan(-80);
    expect(drone.yaw).toBeGreaterThan(-100);
  });

  it('keeps the learned overshoot for the next flight', async () => {
    drone.overshootDeg = 8;
    await settle(runner.run(parse(EXAMPLE_PROGRAM_XML)));
    drone.yaw = 0;
    drone.turns.length = 0;
    const log: string[] = [];
    await settle(runner.run([cmd.takeoff, cmd.turn('RIGHT', 90), cmd.land], { onLog: (m) => log.push(m) }));
    // The first turn of the new flight is already close: 90 ± 2, not 94.
    expect(log.find((m) => m.startsWith('turned'))).toMatch(/turned (8[89]|9[0-2])°/);
  });

  it('lands when the battery runs low in flight', async () => {
    const run = runner.run([cmd.takeoff, cmd.hover(30), cmd.land]);
    await vi.advanceTimersByTimeAsync(5000);
    drone.battery = 10;
    const outcome = await settle(run);
    expect(outcome).toMatchObject({ status: 'FAILED', commandIndex: 1, message: expect.stringMatching(/battery is almost empty \(10%\)/) });
    expect(drone.events).toEqual(['TAKEOFF', 'LAND']);
  });

  it('does not land for a brief dip in the battery reading', async () => {
    const run = runner.run([cmd.takeoff, cmd.hover(4), cmd.land]);
    await vi.advanceTimersByTimeAsync(5000);
    drone.battery = 10;
    await vi.advanceTimersByTimeAsync(1500);
    drone.battery = 60;
    expect(await settle(run)).toEqual({ status: 'COMPLETED' });
  });

  it('turns left with positive yaw and right with negative yaw', async () => {
    await settle(runner.run([cmd.takeoff, cmd.turn('LEFT', 90), cmd.land]));
    expect(drone.yaw).toBeGreaterThan(70);
    expect(drone.yaw).toBeLessThan(110);

    drone.yaw = 0;
    await settle(runner.run([cmd.takeoff, cmd.turn('RIGHT', 45), cmd.land]));
    expect(drone.yaw).toBeLessThan(-30);
    expect(drone.yaw).toBeGreaterThan(-60);
  });

  it('sends strafes and reverses on the right axes', async () => {
    const program = parse(EXAMPLE_PROGRAM_XML).slice(0, 1);
    await settle(
      runner.run([
        ...program,
        { type: 'MOVE', direction: 'LEFT', distanceCm: 20, blockId: null },
        { type: 'MOVE', direction: 'RIGHT', distanceCm: 30, blockId: null },
        { type: 'MOVE', direction: 'BACKWARD', distanceCm: 40, blockId: null },
        cmd.land,
      ]),
    );
    expect(drone.moves.map((m) => [+m.x.toFixed(2), +m.y.toFixed(2)])).toEqual([
      [0, 0.2],
      [0, -0.3],
      [-0.4, 0],
    ]);
  });

  it.each([
    ['low battery', () => (drone.battery = 10), /battery is at 10%/],
    ['already flying', () => (drone.flight = FLIGHT.Flight), /ready on the ground/],
    ['not answering', () => (drone.silent = true), /not answering/],
  ])('refuses to start when %s', async (_name, arrange, message) => {
    arrange();
    await vi.advanceTimersByTimeAsync(2000);
    const outcome = await settle(runner.run([cmd.takeoff, cmd.land]));
    expect(outcome).toMatchObject({ status: 'FAILED', commandIndex: null, message: expect.stringMatching(message) });
    expect(drone.events).toEqual([]);
  });

  it('refuses moves longer than the real-flight limit, and programs without a take off', async () => {
    const tooFar = await settle(runner.run([cmd.takeoff, cmd.forward(RUNNER_LIMITS.maxMoveCm + 1), cmd.land]));
    expect(tooFar).toMatchObject({ status: 'FAILED', message: expect.stringMatching(/at most 500 cm/) });
    const noTakeoff = await settle(runner.run([cmd.hover(1)]));
    expect(noTakeoff).toMatchObject({ status: 'FAILED', message: expect.stringMatching(/take off/) });
    expect(drone.events).toEqual([]);
  });

  it('emergency stop cuts the motors and ends the run', async () => {
    const run = runner.run([cmd.takeoff, cmd.hover(30), cmd.land]);
    await vi.advanceTimersByTimeAsync(5000);
    await settle(runner.emergencyStop());
    const outcome = await settle(run);
    expect(outcome).toEqual({ status: 'STOPPED' });
    expect(drone.events).toContain('STOP');
    expect(drone.events).not.toContain('LAND');
  });

  it('abort lands gently and ends the run', async () => {
    const run = runner.run([cmd.takeoff, cmd.hover(30), cmd.land]);
    await vi.advanceTimersByTimeAsync(5000);
    await settle(runner.abort());
    expect(await settle(run)).toEqual({ status: 'ABORTED' });
    expect(drone.events).toEqual(['TAKEOFF', 'LAND']);
  });

  it('lands and reports the block when the heading stops arriving mid-turn', async () => {
    drone.answerMotion = false;
    const outcome = await settle(runner.run([cmd.takeoff, cmd.turn('RIGHT', 90), cmd.land]));
    expect(outcome).toMatchObject({ status: 'FAILED', commandIndex: 1, message: expect.stringMatching(/heading/) });
    expect(drone.events).toEqual(['TAKEOFF', 'LAND']);
  });

  it('fails without landing commands when the link goes silent', async () => {
    const run = runner.run([cmd.takeoff, cmd.hover(30), cmd.land]);
    await vi.advanceTimersByTimeAsync(5000);
    drone.silent = true;
    const outcome = await settle(run);
    expect(outcome).toMatchObject({ status: 'FAILED', commandIndex: 1, message: expect.stringMatching(/Lost contact/) });
  });
});
