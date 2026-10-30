/**
 * Registers the CoDrone EDU blocks with Blockly and defines the editor theme.
 */
import * as Blockly from 'blockly/core';
import * as En from 'blockly/msg/en';
import { BLOCK_DEFINITIONS, BLOCK_STYLE } from './robolinkBlocks';

export const FONT_STACK =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

let registered = false;

export function registerRobolinkBlocks(): void {
  if (registered) return;
  registered = true;
  Blockly.setLocale(En as unknown as Record<string, string>);
  Blockly.common.defineBlocksWithJsonArray([...BLOCK_DEFINITIONS]);
  // Forgiving, steady stacking: blocks catch a connection from further away
  // and don't flicker between two nearby spots while being dragged.
  Blockly.config.snapRadius = 48;
  Blockly.config.connectingSnapRadius = 64;
  Blockly.config.currentConnectionPreference = 20;
}

const style = (primary: string, secondary: string, tertiary: string) => ({
  colourPrimary: primary,
  colourSecondary: secondary,
  colourTertiary: tertiary,
  hat: '',
});

let theme: Blockly.Theme | null = null;

/** Calm, app-matched palette: one hue per kind of command. */
export function birdsTheme(): Blockly.Theme {
  theme ??= Blockly.Theme.defineTheme('birds', {
    name: 'birds',
    base: Blockly.Themes.Classic,
    blockStyles: {
      [BLOCK_STYLE.flight]: style('#0f9f74', '#d6f5ea', '#0b7d5b'),
      [BLOCK_STYLE.timing]: style('#d98a0b', '#fdf0d5', '#b06f05'),
      [BLOCK_STYLE.move]: style('#3466e8', '#dde7fd', '#2551c4'),
      [BLOCK_STYLE.turn]: style('#7a55e0', '#ebe4fc', '#5f3fc0'),
      [BLOCK_STYLE.number]: style('#ffffff', '#ffffff', '#cfd6e1'),
    },
    componentStyles: {
      workspaceBackgroundColour: '#f7f8fa',
      toolboxBackgroundColour: '#ffffff',
      flyoutBackgroundColour: '#ffffff',
      flyoutForegroundColour: '#667085',
      flyoutOpacity: 1,
      scrollbarColour: '#c5ccd8',
      scrollbarOpacity: 0.6,
      insertionMarkerColour: '#101828',
      insertionMarkerOpacity: 0.25,
      selectedGlowColour: '#2f6bff',
      selectedGlowOpacity: 0.45,
    },
    fontStyle: { family: FONT_STACK, weight: '600', size: 12 },
    startHats: false,
  });
  return theme;
}
