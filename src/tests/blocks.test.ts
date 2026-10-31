import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Blockly from 'blockly/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerRobolinkBlocks } from '../blocks/blocklySetup';
import { programXml } from '../blocks/programXml';
import { PALETTE_BLOCKS, STARTER_PROGRAM_XML } from '../blocks/robolinkBlocks';
import { MAZES } from '../mazes';
import { parseRobolinkXml } from '../parser/RobolinkXmlParser';
import type { DroneCommand } from '../parser/types';

const fixture = readFileSync(resolve(__dirname, 'fixtures/main.xml'), 'utf8');

/** Loads XML into a headless Blockly workspace and serialises it back, like the editor does. */
function roundTrip(xml: string): string {
  const workspace = new Blockly.Workspace();
  Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml), workspace);
  const out = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspace));
  workspace.dispose();
  return out;
}

function commandsOf(xml: string): readonly DroneCommand[] {
  const parsed = parseRobolinkXml(xml);
  if (!parsed.ok) throw new Error(parsed.errors.map((e) => e.message).join('\n'));
  return parsed.commands;
}

beforeAll(() => registerRobolinkBlocks());

describe('Robolink-compatible blocks', () => {
  it('load a real Robolink export and save it back with the same program and block IDs', () => {
    expect(commandsOf(roundTrip(fixture))).toEqual(commandsOf(fixture));
  });

  it('keep Robolink field names and shadow types in the saved XML', () => {
    const xml = roundTrip(fixture);
    expect(xml).toContain('xmlns="https://developers.google.com/blockly/xml"');
    expect(xml).toContain('<field name="TYPE">Direction.FORWARD</field>');
    expect(xml).toContain('<field name="UNIT">cm</field>');
    expect(xml).toContain('<shadow type="only_positive_decimal_50"');
    expect(xml).toContain('<shadow type="limit_0_To_360"');
  });

  it('the program builder writes the same blocks as a real Robolink export', () => {
    const strip = (commands: readonly DroneCommand[]) => commands.map(({ blockId: _id, ...rest }) => rest);
    const uTurn = programXml([
      ['takeoff'],
      ['hover', 2],
      ['forward', 50],
      ['turn-right', 90],
      ['forward', 10],
      ['turn-right', 90],
      ['forward', 50],
      ['land'],
    ]);
    expect(strip(commandsOf(roundTrip(uTurn)))).toEqual(strip(commandsOf(fixture)));
  });

  it.each(MAZES.map((m) => [m.name, m.exampleXml!] as const))('%s example loads into the editor unchanged', (_name, xml) => {
    // Blockly gives the blocks IDs as it loads them; the program itself must not change.
    const strip = (commands: readonly DroneCommand[]) => commands.map(({ blockId: _id, ...rest }) => rest);
    expect(strip(commandsOf(roundTrip(xml)))).toEqual(strip(commandsOf(xml)));
  });

  it('dragging moves one block; Ctrl, ⌘ or Alt moves it with the blocks below', () => {
    const heals = (init?: PointerEventInit) =>
      (Blockly.dragging.BlockDragStrategy.prototype as unknown as { shouldHealStack(e: PointerEvent): boolean }).shouldHealStack.call(
        {},
        new PointerEvent('pointerdown', init),
      );
    expect(heals()).toBe(true);
    expect(heals({ ctrlKey: true })).toBe(false);
    expect(heals({ metaKey: true })).toBe(false);
    expect(heals({ altKey: true })).toBe(false);
  });

  it('starter program is take off then land', () => {
    expect(commandsOf(roundTrip(STARTER_PROGRAM_XML)).map((c) => c.type)).toEqual(['TAKEOFF', 'LAND']);
  });

  it('every palette block builds a valid command', () => {
    const workspace = new Blockly.Workspace();
    expect(PALETTE_BLOCKS).toHaveLength(9);
    for (const item of PALETTE_BLOCKS) {
      const block = Blockly.serialization.blocks.append(item as Blockly.serialization.blocks.State, workspace);
      const xml = `<xml xmlns="https://developers.google.com/blockly/xml">${Blockly.Xml.domToText(Blockly.Xml.blockToDom(block))}</xml>`;
      expect(commandsOf(xml)).toHaveLength(1);
      block.dispose();
    }
    workspace.dispose();
  });
});
