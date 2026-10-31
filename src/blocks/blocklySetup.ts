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
  dragSingleBlocks();
}

/**
 * Dragging a block out of a stack moves just that block, and the blocks below
 * close the gap ("heal" the stack). Holding ⌘, Ctrl or Alt (Option) moves the
 * block with everything below it. On a Mac, Ctrl+click opens the context menu, so
 * Mac users hold ⌘ or Option. This is the reverse of Blockly's default, where a
 * plain drag takes the whole tail of the stack along.
 *
 * Blockly creates each block's drag strategy after the block's own setup runs,
 * so the rule is changed on the strategy class rather than per block.
 * Keyboard moves keep Blockly's behaviour.
 */
function dragSingleBlocks(): void {
  type HealRule = (this: unknown, e: PointerEvent | KeyboardEvent | undefined) => boolean;
  const strategy = Blockly.dragging.BlockDragStrategy.prototype as unknown as { shouldHealStack: HealRule };
  const blocklyRule = strategy.shouldHealStack;
  strategy.shouldHealStack = function (e) {
    if (typeof PointerEvent !== 'undefined' && e instanceof PointerEvent) return !(e.ctrlKey || e.metaKey || e.altKey);
    return blocklyRule.call(this, e);
  };
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
