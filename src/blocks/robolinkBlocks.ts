/**
 * The CoDrone EDU blocks, defined with exactly the block types, field names
 * and shadow types that Robolink Blockly exports (see tests/fixtures/main.xml).
 * Programs built here therefore download as XML that Robolink can open, and
 * they go through the very same parser as an imported file.
 *
 * Pure data: no Blockly import, so it can be used anywhere.
 */

/** Small white line icons shown on the blocks (16 × 16, data URIs). */
function icon(paths: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" ` +
    `stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const ICONS = {
  takeoff: icon('<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/><path d="M5 21h14"/>'),
  land: icon('<path d="M12 3v14"/><path d="m6 11 6 6 6-6"/><path d="M5 21h14"/>'),
  hover: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  move: icon('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>'),
  turn: icon('<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>'),
} as const;

const iconField = (src: string, alt: string) => ({ type: 'field_image', src, width: 16, height: 16, alt });

/** Block styles (colours live in the editor theme). */
export const BLOCK_STYLE = {
  flight: 'flight_blocks',
  timing: 'timing_blocks',
  move: 'move_blocks',
  turn: 'turn_blocks',
  number: 'number_blocks',
} as const;

const statement = { previousStatement: null, nextStatement: null, inputsInline: true };

/** Blockly JSON definitions. */
export const BLOCK_DEFINITIONS: readonly object[] = [
  {
    type: 'takeoff',
    message0: '%1 take off',
    args0: [iconField(ICONS.takeoff, 'Take off')],
    ...statement,
    style: BLOCK_STYLE.flight,
    tooltip: 'Start the motors and rise to flight height.',
  },
  {
    type: 'hover',
    message0: '%1 hover for %2 seconds',
    args0: [iconField(ICONS.hover, 'Hover'), { type: 'input_value', name: 'NUM0', check: 'Number' }],
    ...statement,
    style: BLOCK_STYLE.timing,
    tooltip: 'Stay in place for a number of seconds (0 to 300).',
  },
  {
    type: 'go_distance',
    message0: '%1 go %2 %3 %4',
    args0: [
      iconField(ICONS.move, 'Go'),
      {
        type: 'field_dropdown',
        name: 'TYPE',
        options: [
          ['forward', 'Direction.FORWARD'],
          ['backward', 'Direction.BACKWARD'],
          ['left', 'Direction.LEFT'],
          ['right', 'Direction.RIGHT'],
        ],
      },
      { type: 'input_value', name: 'NUM0', check: 'Number' },
      { type: 'field_dropdown', name: 'UNIT', options: [['cm', 'cm']] },
    ],
    ...statement,
    style: BLOCK_STYLE.move,
    tooltip: 'Fly in a straight line without turning. Left and right slide sideways.',
  },
  {
    type: 'turn_direction_degrees',
    message0: '%1 turn %2 %3 degrees',
    args0: [
      iconField(ICONS.turn, 'Turn'),
      {
        type: 'field_dropdown',
        name: 'TYPE',
        options: [
          ['right', 'Direction.RIGHT'],
          ['left', 'Direction.LEFT'],
        ],
      },
      { type: 'input_value', name: 'NUM0', check: 'Number' },
    ],
    ...statement,
    style: BLOCK_STYLE.turn,
    tooltip: 'Turn on the spot (0 to 360 degrees).',
  },
  {
    type: 'land',
    message0: '%1 land',
    args0: [iconField(ICONS.land, 'Land')],
    ...statement,
    style: BLOCK_STYLE.flight,
    tooltip: 'Come down gently and stop the motors.',
  },
  // Number "shadow" slots, as named by Robolink.
  ...(
    [
      ['only_positive_decimal', 0, undefined],
      ['only_positive_decimal_50', 50, undefined],
      ['limit_0_To_360', 90, 360],
    ] as const
  ).map(([type, value, max]) => ({
    type,
    message0: '%1',
    args0: [{ type: 'field_number', name: 'NUM', value, min: 0, ...(max !== undefined ? { max } : {}) }],
    output: 'Number',
    style: BLOCK_STYLE.number,
  })),
];

const number = (type: string, value: number) => ({ shadow: { type, fields: { NUM: value } } });
const go = (direction: string, cm: number) => ({
  kind: 'block',
  type: 'go_distance',
  fields: { TYPE: `Direction.${direction}`, UNIT: 'cm' },
  inputs: { NUM0: number('only_positive_decimal_50', cm) },
});
const turn = (direction: string, degrees: number) => ({
  kind: 'block',
  type: 'turn_direction_degrees',
  fields: { TYPE: `Direction.${direction}` },
  inputs: { NUM0: number('limit_0_To_360', degrees) },
});

/** Category colours (match the block styles in the editor theme). */
export const CATEGORY_COLOURS = { flight: '#0f9f74', move: '#3466e8', turn: '#7a55e0' } as const;

/**
 * Block palette: a slim rail of categories (like Robolink Blockly). Clicking
 * one slides out its blocks; the drawer closes again once a block is dragged
 * out, so the whole width is free for building.
 */
export const TOOLBOX = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'Flight',
      colour: CATEGORY_COLOURS.flight,
      cssConfig: { row: 'blocklyToolboxCategory toolbox-cat toolbox-cat--flight', icon: 'toolbox-cat__icon' },
      contents: [
        { kind: 'block', type: 'takeoff' },
        { kind: 'block', type: 'hover', inputs: { NUM0: number('only_positive_decimal', 2) } },
        { kind: 'block', type: 'land' },
      ],
    },
    {
      kind: 'category',
      name: 'Move',
      colour: CATEGORY_COLOURS.move,
      cssConfig: { row: 'blocklyToolboxCategory toolbox-cat toolbox-cat--move', icon: 'toolbox-cat__icon' },
      contents: [go('FORWARD', 50), go('BACKWARD', 50), go('LEFT', 50), go('RIGHT', 50)],
    },
    {
      kind: 'category',
      name: 'Turn',
      colour: CATEGORY_COLOURS.turn,
      cssConfig: { row: 'blocklyToolboxCategory toolbox-cat toolbox-cat--turn', icon: 'toolbox-cat__icon' },
      contents: [turn('RIGHT', 90), turn('LEFT', 90)],
    },
  ],
};

/** Every block offered in the palette (for tests and docs). */
export const PALETTE_BLOCKS = TOOLBOX.contents.flatMap((category) => category.contents);

/** A new program: take off, then land. */
export const STARTER_PROGRAM_XML =
  '<xml xmlns="https://developers.google.com/blockly/xml">' +
  '<block type="takeoff" x="40" y="40"><next><block type="land"></block></next></block>' +
  '</xml>';

/** The reference U-turn program (same blocks as main.xml): solves the Beginner Course. */
export const EXAMPLE_PROGRAM_XML =
  '<xml xmlns="https://developers.google.com/blockly/xml">' +
  '<block type="takeoff" x="40" y="40"><next>' +
  '<block type="hover"><value name="NUM0"><shadow type="only_positive_decimal"><field name="NUM">2</field></shadow></value><next>' +
  '<block type="go_distance"><field name="TYPE">Direction.FORWARD</field><field name="UNIT">cm</field>' +
  '<value name="NUM0"><shadow type="only_positive_decimal_50"><field name="NUM">50</field></shadow></value><next>' +
  '<block type="turn_direction_degrees"><field name="TYPE">Direction.RIGHT</field>' +
  '<value name="NUM0"><shadow type="limit_0_To_360"><field name="NUM">90</field></shadow></value><next>' +
  '<block type="go_distance"><field name="TYPE">Direction.FORWARD</field><field name="UNIT">cm</field>' +
  '<value name="NUM0"><shadow type="only_positive_decimal_50"><field name="NUM">10</field></shadow></value><next>' +
  '<block type="turn_direction_degrees"><field name="TYPE">Direction.RIGHT</field>' +
  '<value name="NUM0"><shadow type="limit_0_To_360"><field name="NUM">90</field></shadow></value><next>' +
  '<block type="go_distance"><field name="TYPE">Direction.FORWARD</field><field name="UNIT">cm</field>' +
  '<value name="NUM0"><shadow type="only_positive_decimal_50"><field name="NUM">50</field></shadow></value><next>' +
  '<block type="land"></block>' +
  '</next></block></next></block></next></block></next></block></next></block></next></block></next></block>' +
  '</xml>';
