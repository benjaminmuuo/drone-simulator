/**
 * Intermediate representation produced from Robolink Blockly XML.
 *
 * Every command keeps the Blockly block ID it came from so that parse,
 * validation and simulation errors can point back at the student's block.
 */

export type MoveDirection = 'FORWARD' | 'BACKWARD' | 'LEFT' | 'RIGHT';
export type TurnDirection = 'LEFT' | 'RIGHT';

interface CommandSource {
  /** Blockly block `id` attribute, or null when the block had none. */
  readonly blockId: string | null;
}

export type DroneCommand =
  | ({ readonly type: 'TAKEOFF' } & CommandSource)
  | ({ readonly type: 'LAND' } & CommandSource)
  | ({ readonly type: 'HOVER'; readonly durationSeconds: number } & CommandSource)
  | ({
      readonly type: 'MOVE';
      readonly direction: MoveDirection;
      readonly distanceCm: number;
    } & CommandSource)
  | ({
      readonly type: 'TURN';
      readonly direction: TurnDirection;
      readonly degrees: number;
    } & CommandSource);

export type CommandType = DroneCommand['type'];

export type ParseIssueCode =
  | 'FILE_TOO_LARGE'
  | 'TOO_COMPLEX'
  | 'MALFORMED_XML'
  | 'FORBIDDEN_DOCTYPE'
  | 'NOT_BLOCKLY_XML'
  | 'EMPTY_PROGRAM'
  | 'MULTIPLE_PROGRAMS'
  | 'UNSUPPORTED_BLOCK'
  | 'UNSUPPORTED_FEATURE'
  | 'DISABLED_BLOCK'
  | 'MISSING_PARAMETER'
  | 'INVALID_NUMBER'
  | 'UNSUPPORTED_UNIT'
  | 'UNSUPPORTED_DIRECTION'
  | 'UNSUPPORTED_EXPRESSION'
  | 'UNEXPECTED_STRUCTURE'
  | 'INVALID_SEQUENCE';

export interface ParseIssue {
  readonly code: ParseIssueCode;
  /** Student-friendly explanation of what is wrong and how to fix it. */
  readonly message: string;
  readonly blockId: string | null;
  readonly blockType: string | null;
}

export type ParseResult =
  | {
      readonly ok: true;
      readonly commands: readonly DroneCommand[];
      /** Non-fatal issues, e.g. a program that never lands. */
      readonly warnings: readonly ParseIssue[];
    }
  | {
      readonly ok: false;
      readonly errors: readonly ParseIssue[];
    };

/* ---------- Raw block tree (output of the XML reader, input of the mapper) ---------- */

/** A block (or shadow) plugged into a value input, e.g. a number literal. */
export interface RawValueBlock {
  readonly kind: 'block' | 'shadow';
  readonly type: string;
  readonly id: string | null;
  readonly fields: ReadonlyMap<string, string>;
  /** True when the value block itself has inputs, statements, mutations or a next block. */
  readonly hasNestedContent: boolean;
}

export interface RawValueInput {
  readonly shadow: RawValueBlock | null;
  readonly block: RawValueBlock | null;
}

/** One executable statement block in the top-level stack. */
export interface RawBlock {
  readonly type: string;
  readonly id: string | null;
  readonly disabled: boolean;
  readonly fields: ReadonlyMap<string, string>;
  readonly values: ReadonlyMap<string, RawValueInput>;
  /** Names of `<statement>` inputs (loop/if bodies) — unsupported in Phase 1. */
  readonly statements: readonly string[];
  /** Child element names we did not expect on a statement block. */
  readonly unexpectedChildren: readonly string[];
}
