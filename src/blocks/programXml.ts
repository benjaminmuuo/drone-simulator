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
  | readonly ['turn-left' | 'turn-right', number];

const NS = 'https://developers.google.com/blockly/xml';

const value = (shadow: string, n: number) =>
  `<value name="NUM0"><shadow type="${shadow}"><field name="NUM">${n}</field></shadow></value>`;

function blockOpen(step: ProgramStep, first: boolean): string {
  const at = first ? ' x="40" y="40"' : '';
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
    case 'turn-left':
    case 'turn-right':
      return (
        `<block type="turn_direction_degrees"${at}><field name="TYPE">Direction.${step[0] === 'turn-left' ? 'LEFT' : 'RIGHT'}</field>` +
        value('limit_0_To_360', step[1])
      );
  }
}

/** One stack of blocks, each step chained to the next with `<next>`. */
export function programXml(steps: readonly ProgramStep[]): string {
  let body = '';
  for (let i = steps.length - 1; i >= 0; i--) {
    const next = body ? `<next>${body}</next>` : '';
    body = `${blockOpen(steps[i]!, i === 0)}${next}</block>`;
  }
  return `<xml xmlns="${NS}">${body}</xml>`;
}

/** `steps` repeated `times` times (Robolink's loops aren't supported, so loops are unrolled). */
export const repeat = (times: number, steps: readonly ProgramStep[]): ProgramStep[] =>
  Array.from({ length: times }, () => steps).flat();
