import { describe, expect, it } from 'vitest';
import { buildTimeline, frameAt, trailAt } from '../animation/timeline';
import { programXml } from '../blocks/programXml';
import type { ProgramStep } from '../blocks/programXml';
import { countBlocksBetween, simulate } from '../engine/SimulationEngine';
import { DEFAULT_FLIGHT_HEIGHT_CM, FLIGHT_HEIGHT_LIMITS_CM } from '../mazes/constants';
import { openField } from '../mazes/open-field';
import { describeCommand } from '../parser/describeCommand';
import { PARSER_LIMITS, parseRobolinkXml } from '../parser/RobolinkXmlParser';
import type { DroneCommand, ParseIssue } from '../parser/types';
import { beginnerMaze } from './fixtures/testMazes';

const NS = 'https://developers.google.com/blockly/xml';
const xml = (body: string) => `<xml xmlns="${NS}">${body}</xml>`;
const num = (type: string, n: number | string) => `<shadow type="${type}"><field name="NUM">${n}</field></shadow>`;
const vertical = (id: string, dir: string, cm: number, next = '') =>
  `<block type="go_vertical" id="${id}"><field name="TYPE">Direction.${dir}</field><field name="UNIT">cm</field>` +
  `<value name="NUM0">${num('only_positive_decimal_50', cm)}</value>${next}</block>`;
const turnRight = (id: string, next = '') =>
  `<block type="turn_direction_degrees" id="${id}"><field name="TYPE">Direction.RIGHT</field><value name="NUM0">${num('limit_0_To_360', 90)}</value>${next}</block>`;
const repeat = (id: string, times: number | string, body: string, next = '') =>
  `<block type="controls_repeat_ext" id="${id}"><value name="TIMES">${num('math_number', times)}</value><statement name="DO">${body}</statement>${next}</block>`;
const LAND_NEXT = '<next><block type="land" id="l"/></next>';
/** Take off, then the blocks `inner` builds (given the `<next>` to end with), then land. */
const between = (inner: string | ((next: string) => string)) =>
  xml(`<block type="takeoff" id="t"><next>${typeof inner === 'string' ? inner.replace(/<\/block>$/, `${LAND_NEXT}</block>`) : inner(LAND_NEXT)}</next></block>`);

function commands(text: string): readonly DroneCommand[] {
  const r = parseRobolinkXml(text);
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('; '));
  return r.commands;
}
function errors(text: string): readonly ParseIssue[] {
  const r = parseRobolinkXml(text);
  if (r.ok) throw new Error('expected errors');
  return r.errors;
}
const fly = (steps: readonly ProgramStep[], maze = openField, flightHeightCm?: number) =>
  simulate(commands(programXml([['takeoff'], ...steps, ['land']])), maze, flightHeightCm ? { flightHeightCm } : {});

describe('up / down block', () => {
  it('parses up and down with their block ids', () => {
    expect(commands(between((end) => vertical('u', 'UP', 30, `<next>${vertical('d', 'DOWN', 20, end)}</next>`)))).toEqual([
      { type: 'TAKEOFF', blockId: 't' },
      { type: 'VERTICAL', direction: 'UP', distanceCm: 30, blockId: 'u' },
      { type: 'VERTICAL', direction: 'DOWN', distanceCm: 20, blockId: 'd' },
      { type: 'LAND', blockId: 'l' },
    ]);
    expect(describeCommand({ type: 'VERTICAL', direction: 'UP', distanceCm: 30, blockId: null })).toBe('Up — 30 cm');
  });

  it('rejects other directions', () => {
    expect(errors(between(vertical('v', 'FORWARD', 30)))[0]).toMatchObject({ code: 'UNSUPPORTED_DIRECTION', blockId: 'v' });
  });

  it('changes only the height', () => {
    const { steps } = fly([['up', 30], ['down', 50]]);
    expect(steps.map((s) => s.after.heightCm)).toEqual([80, 110, 60, 0]);
    expect(steps.every((s) => s.after.x === 150 && s.after.y === 110 && s.after.headingDeg === 0)).toBe(true);
  });

  it('refuses to go above the class limit or too close to the floor', () => {
    expect(fly([['up', FLIGHT_HEIGHT_LIMITS_CM.max - DEFAULT_FLIGHT_HEIGHT_CM + 1]]).failure).toMatchObject({ kind: 'TOO_HIGH', commandIndex: 1 });
    expect(fly([['up', FLIGHT_HEIGHT_LIMITS_CM.max - DEFAULT_FLIGHT_HEIGHT_CM]]).failure).toBeNull();
    expect(fly([['down', 70]]).failure).toMatchObject({ kind: 'TOO_LOW', message: expect.stringContaining('use Land') });
    expect(fly([['down', DEFAULT_FLIGHT_HEIGHT_CM - FLIGHT_HEIGHT_LIMITS_CM.min]]).failure).toBeNull();
  });

  it('needs the drone to be flying', () => {
    const r = simulate(commands(xml(vertical('u', 'UP', 30))), openField);
    expect(r.failure).toMatchObject({ kind: 'NOT_FLYING', message: expect.stringContaining('go up') });
  });

  it('flies over a box that is too tall at flight height once it has gone up', () => {
    // A 80 cm box stack lies 160–190 cm ahead of the start.
    expect(fly([['forward', 200]], beginnerMaze).failure?.kind).toBe('COLLISION_OBSTACLE');
    const over = fly([['up', 30], ['forward', 200], ['down', 30]], beginnerMaze);
    expect(over.steps.every((s) => s.failure === null)).toBe(true);
    expect(over.finalState).toMatchObject({ x: 50, y: 50, flight: 'LANDED' });
  });

  it('cannot come down onto a box', () => {
    expect(fly([['up', 30], ['forward', 175], ['down', 30]], beginnerMaze).failure).toMatchObject({
      kind: 'COLLISION_OBSTACLE',
      commandIndex: 3,
      message: expect.stringContaining('come down onto "Box stack"'),
    });
  });

  it('animates the climb and draws the trail at the height it flew', () => {
    const result = fly([['up', 30], ['forward', 50], ['down', 30]]);
    const timeline = buildTimeline(result, openField);
    const climb = timeline.segments[1]!;
    expect([climb.from.altitudeCm, climb.to.altitudeCm]).toEqual([80, 110]);
    expect(climb.end - climb.start).toBeCloseTo(1, 6); // 30 cm at 30 cm/s
    expect(frameAt(timeline, (climb.start + climb.end) / 2).pose.altitudeCm).toBeCloseTo(95, 6);
    expect(trailAt(timeline, timeline.totalSeconds)).toEqual([
      { x: 150, y: 110, altitudeCm: 80 },
      { x: 150, y: 110, altitudeCm: 110 },
      { x: 150, y: 60, altitudeCm: 110 },
      { x: 150, y: 60, altitudeCm: 80 },
    ]);
  });

  it('leaves take off and landing out of the trail', () => {
    const timeline = buildTimeline(fly([['hover', 1]]), openField);
    expect(trailAt(timeline, 0.5)).toEqual([]);
    expect(trailAt(timeline, timeline.totalSeconds)).toEqual([{ x: 150, y: 110, altitudeCm: 80 }]);
  });
});

describe('repeat block', () => {
  it('writes its body out the given number of times, keeping the block ids', () => {
    const cs = commands(between(repeat('r', 4, turnRight('t1'))));
    expect(cs.map((c) => c.type)).toEqual(['TAKEOFF', 'TURN', 'TURN', 'TURN', 'TURN', 'LAND']);
    expect(cs.slice(1, 5).every((c) => c.blockId === 't1')).toBe(true);
  });

  it('runs the blocks after it, and loops inside loops', () => {
    const cs = commands(between((end) => repeat('outer', 2, repeat('inner', 3, turnRight('a')), `<next>${vertical('u', 'UP', 10, end)}</next>`)));
    expect(cs.filter((c) => c.type === 'TURN')).toHaveLength(6);
    expect(cs.at(-2)).toMatchObject({ type: 'VERTICAL', blockId: 'u' });
  });

  it('reads the older repeat block with the number typed in', () => {
    const old = `<block type="controls_repeat" id="r"><field name="TIMES">3</field><statement name="DO">${turnRight('a')}</statement></block>`;
    expect(commands(between(old)).filter((c) => c.type === 'TURN')).toHaveLength(3);
  });

  it('an empty loop or 0 times runs nothing', () => {
    expect(commands(between(`<block type="controls_repeat_ext" id="r"><value name="TIMES">${num('math_number', 5)}</value></block>`))).toHaveLength(2);
    expect(commands(between(repeat('r', 0, turnRight('a'))))).toHaveLength(2);
  });

  it('rejects counts that are not whole numbers or too large', () => {
    expect(errors(between(repeat('r', 2.5, turnRight('a'))))[0]).toMatchObject({ code: 'INVALID_NUMBER', blockId: 'r' });
    expect(errors(between(repeat('r', 21, turnRight('a'))))[0]).toMatchObject({ code: 'INVALID_NUMBER', blockId: 'r' });
  });

  it('reports a bad block inside the loop with its own id', () => {
    const bad = `<block type="controls_whileUntil" id="w"/>`;
    expect(errors(between(repeat('r', 2, bad)))).toEqual([expect.objectContaining({ code: 'UNSUPPORTED_BLOCK', blockId: 'w' })]);
  });

  it('refuses loops nested too deep', () => {
    let body = turnRight('a');
    for (let i = 0; i <= PARSER_LIMITS.maxNesting; i++) body = repeat(`r${i}`, 1, body);
    expect(errors(between(body)).map((e) => e.code)).toContain('TOO_COMPLEX');
  });

  it('refuses a program that writes out to too many blocks', () => {
    const big = repeat('a', 20, repeat('b', 20, repeat('c', 20, turnRight('t'))));
    expect(errors(between(big))[0]).toMatchObject({ code: 'TOO_COMPLEX' });
  });

  it('builds example programs with a real loop block', () => {
    const text = programXml([['takeoff'], ['repeat', 4, [['turn-right', 90]]], ['land']]);
    expect(text).toContain('<block type="controls_repeat_ext" id="b2"><value name="TIMES"><shadow type="math_number">');
    expect(commands(text).map((c) => c.type)).toEqual(['TAKEOFF', 'TURN', 'TURN', 'TURN', 'TURN', 'LAND']);
  });

  it('counts the blocks a student placed, not how often they run', () => {
    expect(countBlocksBetween(commands(between(repeat('r', 4, turnRight('a', `<next>${vertical('u', 'UP', 5)}</next>`)))))).toBe(2);
    expect(countBlocksBetween(commands(xml('<block type="takeoff" id="t"/>')))).toBe(0);
  });
});
