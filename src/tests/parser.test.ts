import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeCommand } from '../parser/describeCommand';
import { PARSER_LIMITS, parseRobolinkXml } from '../parser/RobolinkXmlParser';
import type { DroneCommand, ParseIssue, ParseResult } from '../parser/types';

const fixture = readFileSync(resolve(__dirname, 'fixtures/main.xml'), 'utf8');
const NS = 'https://developers.google.com/blockly/xml';

function expectOk(result: ParseResult): readonly DroneCommand[] {
  if (!result.ok) throw new Error(`Expected success, got: ${result.errors.map((e) => e.message).join('; ')}`);
  return result.commands;
}

function expectErrors(result: ParseResult): readonly ParseIssue[] {
  if (result.ok) throw new Error('Expected parse errors but parsing succeeded');
  return result.errors;
}

/** Wraps statement blocks (already chained via <next>) in a Blockly document. */
function program(body: string, ns = true): string {
  return `<xml${ns ? ` xmlns="${NS}"` : ''}>${body}</xml>`;
}

function goDistance(opts: { id?: string; type?: string; unit?: string; value?: string; next?: string }): string {
  const value =
    opts.value ??
    `<value name="NUM0"><shadow type="only_positive_decimal_50" id="s1"><field name="NUM">50</field></shadow></value>`;
  return (
    `<block type="go_distance" id="${opts.id ?? 'g1'}">` +
    `<field name="TYPE">${opts.type ?? 'Direction.FORWARD'}</field>` +
    `<field name="UNIT">${opts.unit ?? 'cm'}</field>${value}` +
    (opts.next ? `<next>${opts.next}</next>` : '') +
    `</block>`
  );
}

/** Puts `inner` after a takeoff block (the missing land only produces a warning). */
function withFlight(inner: string): string {
  return program(`<block type="takeoff" id="t"><next>${inner}</next></block>`);
}

describe('parseRobolinkXml — reference fixture main.xml', () => {
  const result = parseRobolinkXml(fixture);
  const commands = expectOk(result);

  it('produces exactly eight commands in the correct order', () => {
    expect(commands.map((c) => c.type)).toEqual([
      'TAKEOFF',
      'HOVER',
      'MOVE',
      'TURN',
      'MOVE',
      'TURN',
      'MOVE',
      'LAND',
    ]);
  });

  it('extracts the full command payloads', () => {
    expect(commands).toEqual([
      { type: 'TAKEOFF', blockId: 'I70WrNhz.^S(`yUbFg({' },
      { type: 'HOVER', durationSeconds: 2, blockId: 'wP^sB$g8ZY#|plweMs_[' },
      { type: 'MOVE', direction: 'FORWARD', distanceCm: 50, blockId: 'u^Q[2l2K1VSTa1xKFqj[' },
      { type: 'TURN', direction: 'RIGHT', degrees: 90, blockId: 'zEos8%DoqM2tUn5Nu%c1' },
      { type: 'MOVE', direction: 'FORWARD', distanceCm: 10, blockId: '}48n{DaCC9m+@[7J$EY{' },
      { type: 'TURN', direction: 'RIGHT', degrees: 90, blockId: 'b=Iqg(ia,|~#xj4QG)9.' },
      { type: 'MOVE', direction: 'FORWARD', distanceCm: 50, blockId: 'O{`8f;i8v@OKUww$S$W}' },
      { type: 'LAND', blockId: ':4V:#Sy{Qa-Zcf8bUFfv' },
    ]);
  });

  it('extracts the 2 second hover', () => {
    expect(commands.find((c) => c.type === 'HOVER')).toMatchObject({ durationSeconds: 2 });
  });

  it('extracts forward distances of 50, 10 and 50 cm', () => {
    const moves = commands.filter((c) => c.type === 'MOVE');
    expect(moves.map((m) => [m.direction, m.distanceCm])).toEqual([
      ['FORWARD', 50],
      ['FORWARD', 10],
      ['FORWARD', 50],
    ]);
  });

  it('extracts both right turns of 90 degrees', () => {
    const turns = commands.filter((c) => c.type === 'TURN');
    expect(turns.map((t) => [t.direction, t.degrees])).toEqual([
      ['RIGHT', 90],
      ['RIGHT', 90],
    ]);
  });

  it('reports no sequence warnings for a valid takeoff → land program', () => {
    expect(result.ok && result.warnings).toEqual([]);
  });

  it('renders the preview labels expected by students', () => {
    expect(commands.map(describeCommand)).toEqual([
      'Takeoff',
      'Hover — 2 seconds',
      'Forward — 50 cm',
      'Turn right — 90°',
      'Forward — 10 cm',
      'Turn right — 90°',
      'Forward — 50 cm',
      'Land',
    ]);
  });
});

describe('parseRobolinkXml — namespaces', () => {
  it('accepts the Blockly namespace and un-namespaced documents identically', () => {
    const body = `<block type="takeoff" id="a"><next><block type="land" id="b"></block></next></block>`;
    expect(expectOk(parseRobolinkXml(program(body, true)))).toEqual(
      expectOk(parseRobolinkXml(program(body, false))),
    );
  });

  it('accepts a prefixed Blockly namespace', () => {
    const xml = `<b:xml xmlns:b="${NS}"><b:block type="takeoff" id="a"><b:next><b:block type="land" id="b"/></b:next></b:block></b:xml>`;
    expect(expectOk(parseRobolinkXml(xml)).map((c) => c.type)).toEqual(['TAKEOFF', 'LAND']);
  });

  it('rejects a root element from a different namespace', () => {
    const xml = `<xml xmlns="http://example.com/other"><block type="takeoff"/></xml>`;
    expect(expectErrors(parseRobolinkXml(xml))[0]?.code).toBe('NOT_BLOCKLY_XML');
  });
});

describe('parseRobolinkXml — malformed input', () => {
  it.each([
    ['unclosed tags', `<xml xmlns="${NS}"><block type="takeoff">`],
    ['plain text', 'takeoff then land'],
    ['Python source', 'drone.takeoff()\ndrone.land()'],
    ['empty file', '   '],
  ])('reports MALFORMED_XML for %s', (_label, text) => {
    expect(expectErrors(parseRobolinkXml(text))[0]?.code).toBe('MALFORMED_XML');
  });

  it('rejects well-formed XML that is not a Blockly document', () => {
    expect(expectErrors(parseRobolinkXml('<html><body/></html>'))[0]?.code).toBe('NOT_BLOCKLY_XML');
  });

  it('rejects documents containing a DOCTYPE', () => {
    const xml = `<!DOCTYPE xml [<!ENTITY a "aaaa">]><xml xmlns="${NS}"><block type="takeoff"/></xml>`;
    expect(expectErrors(parseRobolinkXml(xml))[0]?.code).toBe('FORBIDDEN_DOCTYPE');
  });

  it('rejects files above the size limit before parsing', () => {
    const huge = program(`<!--${'x'.repeat(PARSER_LIMITS.maxFileBytes)}-->`);
    expect(expectErrors(parseRobolinkXml(huge))[0]?.code).toBe('FILE_TOO_LARGE');
  });

  it('rejects documents with too many elements', () => {
    const many = '<comment/>'.repeat(PARSER_LIMITS.maxElements + 1);
    expect(expectErrors(parseRobolinkXml(program(many)))[0]?.code).toBe('TOO_COMPLEX');
  });

  it('reports an empty workspace', () => {
    expect(expectErrors(parseRobolinkXml(program('')))[0]?.code).toBe('EMPTY_PROGRAM');
  });

  it('rejects multiple disconnected block stacks', () => {
    const xml = program(`<block type="takeoff" id="a"/><block type="land" id="b"/>`);
    expect(expectErrors(parseRobolinkXml(xml))[0]?.code).toBe('MULTIPLE_PROGRAMS');
  });
});

describe('parseRobolinkXml — unsupported content', () => {
  it('rejects unsupported block types and keeps the block id', () => {
    const xml = program(
      `<block type="takeoff" id="t"><next><block type="controls_repeat_ext" id="loop1"><next><block type="land" id="l"/></next></block></next></block>`,
    );
    const [error] = expectErrors(parseRobolinkXml(xml));
    expect(error).toMatchObject({ code: 'UNSUPPORTED_BLOCK', blockId: 'loop1', blockType: 'controls_repeat_ext' });
  });

  it('rejects nested statement inputs on supported blocks', () => {
    const xml = program(
      `<block type="takeoff" id="t"><statement name="DO"><block type="land" id="x"/></statement></block>`,
    );
    expect(expectErrors(parseRobolinkXml(xml))[0]).toMatchObject({ code: 'UNEXPECTED_STRUCTURE', blockId: 't' });
  });

  it('rejects mutations and other unexpected child elements', () => {
    const xml = program(`<block type="takeoff" id="t"><mutation items="2"/></block>`);
    expect(expectErrors(parseRobolinkXml(xml))[0]?.code).toBe('UNEXPECTED_STRUCTURE');
  });

  it('rejects disabled blocks instead of silently skipping them', () => {
    const xml = withFlight(goDistance({ id: 'off' }).replace('id="off"', 'id="off" disabled="true"'));
    expect(expectErrors(parseRobolinkXml(xml))[0]).toMatchObject({ code: 'DISABLED_BLOCK', blockId: 'off' });
  });

  it('rejects workspaces that declare variables', () => {
    const xml = program(`<variables><variable id="v">speed</variable></variables><block type="takeoff"/>`);
    expect(expectErrors(parseRobolinkXml(xml))[0]?.code).toBe('UNSUPPORTED_FEATURE');
  });

  it('ignores an empty <variables/> element', () => {
    const xml = program(`<variables/><block type="takeoff" id="t"><next><block type="land" id="l"/></next></block>`);
    expect(expectOk(parseRobolinkXml(xml))).toHaveLength(2);
  });

  it('rejects unsupported units', () => {
    const xml = withFlight(goDistance({ id: 'm1', unit: 'ft' }));
    expect(expectErrors(parseRobolinkXml(xml))[0]).toMatchObject({ code: 'UNSUPPORTED_UNIT', blockId: 'm1' });
  });

  it('rejects unknown move directions', () => {
    const xml = withFlight(goDistance({ id: 'm1', type: 'Direction.UP' }));
    expect(expectErrors(parseRobolinkXml(xml))[0]).toMatchObject({ code: 'UNSUPPORTED_DIRECTION', blockId: 'm1' });
  });

  it('rejects FORWARD as a turn direction', () => {
    const turn = `<block type="turn_direction_degrees" id="tr"><field name="TYPE">Direction.FORWARD</field><value name="NUM0"><shadow type="limit_0_To_360"><field name="NUM">90</field></shadow></value></block>`;
    expect(expectErrors(parseRobolinkXml(withFlight(turn)))[0]?.code).toBe('UNSUPPORTED_DIRECTION');
  });

  it('supports backward, left and right movement directions', () => {
    const xml = withFlight(
      goDistance({
        id: 'a',
        type: 'Direction.BACKWARD',
        next: goDistance({ id: 'b', type: 'Direction.LEFT', next: goDistance({ id: 'c', type: 'Direction.RIGHT' }) }),
      }),
    );
    const moves = expectOk(parseRobolinkXml(xml)).filter((c) => c.type === 'MOVE');
    expect(moves.map((m) => m.direction)).toEqual(['BACKWARD', 'LEFT', 'RIGHT']);
  });
});

describe('parseRobolinkXml — value inputs', () => {
  it('uses a connected number block instead of the shadow default', () => {
    const value =
      `<value name="NUM0"><shadow type="only_positive_decimal_50" id="sh"><field name="NUM">50</field></shadow>` +
      `<block type="math_number" id="real"><field name="NUM">120</field></block></value>`;
    const commands = expectOk(parseRobolinkXml(withFlight(goDistance({ value }))));
    expect(commands[1]).toMatchObject({ type: 'MOVE', distanceCm: 120 });
  });

  it('rejects a connected expression block rather than falling back to the shadow', () => {
    const value =
      `<value name="NUM0"><shadow type="only_positive_decimal_50"><field name="NUM">50</field></shadow>` +
      `<block type="math_arithmetic" id="expr"><field name="OP">ADD</field>` +
      `<value name="A"><shadow type="math_number"><field name="NUM">1</field></shadow></value></block></value>`;
    const errors = expectErrors(parseRobolinkXml(withFlight(goDistance({ id: 'mv', value }))));
    expect(errors[0]).toMatchObject({ code: 'UNSUPPORTED_EXPRESSION', blockId: 'mv' });
  });

  it('rejects variable getter blocks as values', () => {
    const value = `<value name="NUM0"><block type="variables_get"><field name="VAR">x</field></block></value>`;
    expect(expectErrors(parseRobolinkXml(withFlight(goDistance({ value }))))[0]?.code).toBe(
      'UNSUPPORTED_EXPRESSION',
    );
  });

  it.each([
    ['text', 'fifty'],
    ['hex', '0x10'],
    ['infinity', 'Infinity'],
    ['comma decimal', '1,5'],
    ['negative', '-5'],
    ['too large', '100000'],
  ])('rejects an invalid distance (%s)', (_label, num) => {
    const value = `<value name="NUM0"><shadow type="only_positive_decimal_50"><field name="NUM">${num}</field></shadow></value>`;
    expect(expectErrors(parseRobolinkXml(withFlight(goDistance({ value }))))[0]?.code).toBe('INVALID_NUMBER');
  });

  it('accepts decimal values', () => {
    const value = `<value name="NUM0"><shadow type="only_positive_decimal_50"><field name="NUM">12.5</field></shadow></value>`;
    expect(expectOk(parseRobolinkXml(withFlight(goDistance({ value }))))[1]).toMatchObject({ distanceCm: 12.5 });
  });

  it('rejects turn angles above 360°', () => {
    const turn = `<block type="turn_direction_degrees" id="tr"><field name="TYPE">Direction.LEFT</field><value name="NUM0"><shadow type="limit_0_To_360"><field name="NUM">400</field></shadow></value></block>`;
    expect(expectErrors(parseRobolinkXml(withFlight(turn)))[0]).toMatchObject({ code: 'INVALID_NUMBER', blockId: 'tr' });
  });

  it('reports a missing value input', () => {
    const hover = `<block type="hover" id="h"></block>`;
    expect(expectErrors(parseRobolinkXml(withFlight(hover)))[0]).toMatchObject({ code: 'MISSING_PARAMETER', blockId: 'h' });
  });

  it('reports a missing NUM field', () => {
    const hover = `<block type="hover" id="h"><value name="NUM0"><shadow type="only_positive_decimal"></shadow></value></block>`;
    expect(expectErrors(parseRobolinkXml(withFlight(hover)))[0]?.code).toBe('MISSING_PARAMETER');
  });

  it('reports missing TYPE and UNIT fields', () => {
    const block = `<block type="go_distance" id="g"><value name="NUM0"><shadow type="only_positive_decimal_50"><field name="NUM">5</field></shadow></value></block>`;
    const errors = expectErrors(parseRobolinkXml(withFlight(block)));
    expect(errors.map((e) => e.code)).toEqual(['MISSING_PARAMETER', 'MISSING_PARAMETER']);
    expect(errors.every((e) => e.blockId === 'g')).toBe(true);
  });

  it('collects errors from several blocks at once', () => {
    const xml = withFlight(goDistance({ id: 'a', unit: 'mm', next: goDistance({ id: 'b', type: 'Direction.UP' }) }));
    expect(expectErrors(parseRobolinkXml(xml)).map((e) => e.blockId)).toEqual(['a', 'b']);
  });
});

describe('parseRobolinkXml — sequence warnings', () => {
  it('warns when moving before takeoff', () => {
    const result = parseRobolinkXml(program(goDistance({ id: 'early' })));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ code: 'INVALID_SEQUENCE', blockId: 'early' });
  });

  it('warns when the program ends while flying', () => {
    const result = parseRobolinkXml(withFlight(goDistance({ id: 'm' })));
    expect(result.ok && result.warnings.map((w) => w.message)).toEqual([
      'The program ends while the drone is still flying. Add a Land block at the end.',
    ]);
  });

  it('warns about a double takeoff', () => {
    const xml = program(
      `<block type="takeoff" id="a"><next><block type="takeoff" id="b"><next><block type="land" id="c"/></next></block></next></block>`,
    );
    const result = parseRobolinkXml(xml);
    expect(result.ok && result.warnings.map((w) => w.blockId)).toEqual(['b']);
  });
});
