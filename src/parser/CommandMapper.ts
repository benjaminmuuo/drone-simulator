/**
 * Maps raw Robolink Blockly blocks to typed drone commands.
 *
 * Only block types confirmed from a real Robolink export (tests/fixtures/main.xml)
 * are supported. Anything else is reported, never silently skipped.
 */
import type {
  DroneCommand,
  MoveDirection,
  ParseIssue,
  RawBlock,
  RawValueBlock,
  TurnDirection,
} from './types';

/**
 * Number-literal block types whose only content is a NUM field.
 * The three Robolink types are confirmed in main.xml as shadows; `math_number`
 * is the standard Blockly literal a student may plug in instead.
 */
export const NUMERIC_LITERAL_TYPES = new Set([
  'only_positive_decimal',
  'only_positive_decimal_50',
  'limit_0_To_360',
  'math_number',
]);

/** Distance units → centimetres. Only `cm` is confirmed from a real export. */
const UNIT_TO_CM: Readonly<Record<string, number>> = { cm: 1 };

const MOVE_DIRECTIONS: Readonly<Record<string, MoveDirection>> = {
  'Direction.FORWARD': 'FORWARD',
  'Direction.BACKWARD': 'BACKWARD',
  'Direction.LEFT': 'LEFT',
  'Direction.RIGHT': 'RIGHT',
};

const TURN_DIRECTIONS: Readonly<Record<string, TurnDirection>> = {
  'Direction.LEFT': 'LEFT',
  'Direction.RIGHT': 'RIGHT',
};

export const PARAMETER_LIMITS = {
  hoverSeconds: { min: 0, max: 300 },
  distanceCm: { min: 0, max: 10_000 },
  turnDegrees: { min: 0, max: 360 },
} as const;

/** Human-friendly names used in error messages. */
const BLOCK_LABELS: Readonly<Record<string, string>> = {
  takeoff: 'Takeoff',
  land: 'Land',
  hover: 'Hover',
  go_distance: 'Go (distance)',
  turn_direction_degrees: 'Turn (degrees)',
};

interface BlockSpec {
  readonly fields: readonly string[];
  readonly values: readonly string[];
  readonly map: (block: RawBlock, ctx: MapContext) => DroneCommand | null;
}

class MapContext {
  readonly errors: ParseIssue[] = [];

  constructor(readonly block: RawBlock) {}

  get label(): string {
    return BLOCK_LABELS[this.block.type] ?? this.block.type;
  }

  report(code: ParseIssue['code'], message: string): null {
    this.errors.push({ code, message, blockId: this.block.id, blockType: this.block.type });
    return null;
  }

  field(name: string): string | null {
    const value = this.block.fields.get(name);
    if (value === undefined || value === '') {
      return this.report('MISSING_PARAMETER', `The ${this.label} block is missing its ${name} setting.`);
    }
    return value;
  }

  number(inputName: string, limits: { min: number; max: number }, what: string): number | null {
    const input = this.block.values.get(inputName);
    if (!input || (input.block === null && input.shadow === null)) {
      return this.report('MISSING_PARAMETER', `The ${this.label} block is missing its ${what}.`);
    }
    // A real connected block always wins over the shadow default.
    const source = input.block ?? input.shadow;
    if (!source) return null;
    const literal = this.literalText(source, what);
    if (literal === null) return null;

    const value = parseDecimal(literal);
    if (value === null) {
      return this.report('INVALID_NUMBER', `The ${this.label} block's ${what} "${literal}" is not a number.`);
    }
    if (value < limits.min || value > limits.max) {
      return this.report(
        'INVALID_NUMBER',
        `The ${this.label} block's ${what} is ${value}, but it must be between ${limits.min} and ${limits.max}.`,
      );
    }
    return value;
  }

  private literalText(source: RawValueBlock, what: string): string | null {
    if (!NUMERIC_LITERAL_TYPES.has(source.type) || source.hasNestedContent) {
      return this.report(
        'UNSUPPORTED_EXPRESSION',
        `The ${this.label} block's ${what} uses a "${source.type}" block. The simulator only understands plain numbers here for now.`,
      );
    }
    const extraFields = [...source.fields.keys()].filter((name) => name !== 'NUM');
    if (extraFields.length > 0) {
      return this.report(
        'UNSUPPORTED_EXPRESSION',
        `The ${this.label} block's ${what} has unexpected settings (${extraFields.join(', ')}).`,
      );
    }
    const text = source.fields.get('NUM');
    if (text === undefined || text === '') {
      return this.report('MISSING_PARAMETER', `The ${this.label} block is missing its ${what}.`);
    }
    return text;
  }
}

const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** Strict decimal parsing: rejects '', hex, 'Infinity', '1,5', etc. */
export function parseDecimal(text: string): number | null {
  if (!DECIMAL.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

const BLOCK_SPECS: Readonly<Record<string, BlockSpec>> = {
  takeoff: {
    fields: [],
    values: [],
    map: (block) => ({ type: 'TAKEOFF', blockId: block.id }),
  },
  land: {
    fields: [],
    values: [],
    map: (block) => ({ type: 'LAND', blockId: block.id }),
  },
  hover: {
    fields: [],
    values: ['NUM0'],
    map: (block, ctx) => {
      const seconds = ctx.number('NUM0', PARAMETER_LIMITS.hoverSeconds, 'number of seconds');
      return seconds === null ? null : { type: 'HOVER', durationSeconds: seconds, blockId: block.id };
    },
  },
  go_distance: {
    fields: ['TYPE', 'UNIT'],
    values: ['NUM0'],
    map: (block, ctx) => {
      const dirText = ctx.field('TYPE');
      const unitText = ctx.field('UNIT');
      const amount = ctx.number('NUM0', PARAMETER_LIMITS.distanceCm, 'distance');

      const direction = dirText === null ? undefined : MOVE_DIRECTIONS[dirText];
      if (dirText !== null && direction === undefined) {
        ctx.report('UNSUPPORTED_DIRECTION', `The ${ctx.label} block has an unknown direction "${dirText}".`);
      }
      const factor = unitText === null ? undefined : UNIT_TO_CM[unitText];
      if (unitText !== null && factor === undefined) {
        ctx.report(
          'UNSUPPORTED_UNIT',
          `The ${ctx.label} block uses the unit "${unitText}". The simulator currently supports: ${Object.keys(UNIT_TO_CM).join(', ')}.`,
        );
      }
      if (direction === undefined || factor === undefined || amount === null) return null;
      return { type: 'MOVE', direction, distanceCm: amount * factor, blockId: block.id };
    },
  },
  turn_direction_degrees: {
    fields: ['TYPE'],
    values: ['NUM0'],
    map: (block, ctx) => {
      const dirText = ctx.field('TYPE');
      const degrees = ctx.number('NUM0', PARAMETER_LIMITS.turnDegrees, 'angle');
      const direction = dirText === null ? undefined : TURN_DIRECTIONS[dirText];
      if (dirText !== null && direction === undefined) {
        ctx.report(
          'UNSUPPORTED_DIRECTION',
          `The ${ctx.label} block has the direction "${dirText}", but turns can only be LEFT or RIGHT.`,
        );
      }
      if (direction === undefined || degrees === null) return null;
      return { type: 'TURN', direction, degrees, blockId: block.id };
    },
  },
};

export const SUPPORTED_BLOCK_TYPES: readonly string[] = Object.keys(BLOCK_SPECS);

function checkStructure(spec: BlockSpec, block: RawBlock, ctx: MapContext): void {
  if (block.statements.length > 0) {
    ctx.report('UNEXPECTED_STRUCTURE', `The ${ctx.label} block has blocks nested inside it, which it should not.`);
  }
  if (block.unexpectedChildren.length > 0) {
    ctx.report(
      'UNEXPECTED_STRUCTURE',
      `The ${ctx.label} block contains unexpected parts: ${block.unexpectedChildren.join(', ')}.`,
    );
  }
  const extraFields = [...block.fields.keys()].filter((name) => !spec.fields.includes(name));
  const extraValues = [...block.values.keys()].filter((name) => !spec.values.includes(name));
  if (extraFields.length > 0 || extraValues.length > 0) {
    ctx.report(
      'UNEXPECTED_STRUCTURE',
      `The ${ctx.label} block has settings the simulator does not recognise: ${[...extraFields, ...extraValues].join(', ')}.`,
    );
  }
}

export function mapBlocksToCommands(blocks: readonly RawBlock[]): {
  commands: DroneCommand[];
  errors: ParseIssue[];
} {
  const commands: DroneCommand[] = [];
  const errors: ParseIssue[] = [];

  for (const block of blocks) {
    const ctx = new MapContext(block);
    const spec = BLOCK_SPECS[block.type];

    if (!spec) {
      ctx.report(
        'UNSUPPORTED_BLOCK',
        block.type === ''
          ? 'A block has no type and cannot be understood.'
          : `The "${block.type}" block is not supported by the simulator yet. Supported blocks: ${SUPPORTED_BLOCK_TYPES.join(', ')}.`,
      );
    } else if (block.disabled) {
      ctx.report(
        'DISABLED_BLOCK',
        `The ${ctx.label} block is disabled. Enable it or delete it in Blockly so the program is clear.`,
      );
    } else {
      checkStructure(spec, block, ctx);
      const command = spec.map(block, ctx);
      if (command && ctx.errors.length === 0) commands.push(command);
    }
    errors.push(...ctx.errors);
  }

  return { commands, errors };
}
