import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Blockly from 'blockly/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerRobolinkBlocks } from '../blocks/blocklySetup';
import { EXAMPLE_PROGRAM_XML, PALETTE_BLOCKS, STARTER_PROGRAM_XML } from '../blocks/robolinkBlocks';
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

  it('example program matches the reference program', () => {
    const strip = (commands: readonly DroneCommand[]) => commands.map(({ blockId: _id, ...rest }) => rest);
    expect(strip(commandsOf(roundTrip(EXAMPLE_PROGRAM_XML)))).toEqual(strip(commandsOf(fixture)));
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
