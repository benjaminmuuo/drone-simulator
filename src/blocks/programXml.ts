/**
 * Builds Robolink Blockly XML from a short list of steps, using exactly the
 * block types, fields and shadow types Robolink exports (see robolinkBlocks.ts).
 * Used for each course's example program, so it opens in the editor and
 * downloads to Robolink Blockly like any imported file.
 */

export type ProgramStep =
  | readonly ['takeoff']
  | readonly ['land']
  | readonly ['hover', number]
  | readonly ['forward' | 'backward' | 'left' | 'right', number]
  | readonly ['up' | 'down', number]
  | readonly ['turn-left' | 'turn-right', number]
  /** A real loop block (Blockly's controls_repeat_ext) with these steps inside. */
  | readonly ['repeat', number, readonly ProgramStep[]];

const NS = 'https://developers.google.com/blockly/xml';

const value = (shadow: string, n: number) =>
  `<value name="NUM0"><shadow type="${shadow}"><field name="NUM">${n}</field></shadow></value>`;

/** Gives each block a unique id (`b1`, `b2`, …), as Blockly does, so loop copies can be told apart from separate blocks. */
interface Ids {
  next: number;
}

function blockOpen(step: ProgramStep, first: boolean, ids: Ids): string {
  const at = ` id="b${ids.next++}"${first ? ' x="40" y="40"' : ''}`;
  switch (step[0]) {
    case 'takeoff':
      return `<block type="takeoff"${at}>`;
    case 'land':
      return `<block type="land"${at}>`;
    case 'hover':
      return `<block type="hover"${at}>${value('only_positive_decimal', step[1])}`;
    case 'forward':
    case 'backward':
    case 'left':
    case 'right':
      return (
        `<block type="go_distance"${at}><field name="TYPE">Direction.${step[0].toUpperCase()}</field>` +
        `<field name="UNIT">cm</field>${value('only_positive_decimal_50', step[1])}`
      );
    case 'up':
    case 'down':
      return (
        `<block type="go_vertical"${at}><field name="TYPE">Direction.${step[0].toUpperCase()}</field>` +
        `<field name="UNIT">cm</field>${value('only_positive_decimal_50', step[1])}`
      );
    case 'repeat':
      return (
        `<block type="controls_repeat_ext"${at}><value name="TIMES"><shadow type="math_number"><field name="NUM">${step[1]}</field></shadow></value>` +
        `<statement name="DO">${chain(step[2], false, ids)}</statement>`
      );
    case 'turn-left':
    case 'turn-right':
      return (
        `<block type="turn_direction_degrees"${at}><field name="TYPE">Direction.${step[0] === 'turn-left' ? 'LEFT' : 'RIGHT'}</field>` +
        value('limit_0_To_360', step[1])
      );
  }
}

/** Blocks chained with `<next>`; `placed` gives the first one its workspace position. */
function chain(steps: readonly ProgramStep[], placed: boolean, ids: Ids): string {
  // Opened first to last so ids run in program order; closed last to first to nest each <next>.
  const opened = steps.map((step, i) => blockOpen(step, placed && i === 0, ids));
  let body = '';
  for (let i = opened.length - 1; i >= 0; i--) {
    const next = body ? `<next>${body}</next>` : '';
    body = `${opened[i]}${next}</block>`;
  }
  return body;
}

/** One stack of blocks, each step chained to the next with `<next>`. */
export function programXml(steps: readonly ProgramStep[]): string {
  return `<xml xmlns="${NS}">${chain(steps, true, { next: 1 })}</xml>`;
}

/** `steps` written out `times` times, without a loop block (for the courses that teach before loops). */
export const repeat = (times: number, steps: readonly ProgramStep[]): ProgramStep[] =>
  Array.from({ length: times }, () => steps).flat();
