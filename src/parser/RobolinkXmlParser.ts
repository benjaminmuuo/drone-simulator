/**
 * Reads Blockly XML exported from https://codrone.robolink.com/edu/blockly/
 * into a flat list of raw statement blocks, then hands them to the
 * CommandMapper to build typed drone commands.
 *
 * Uses the browser DOMParser (namespace-aware) — never regular expressions —
 * and never evaluates any code contained in the file.
 */
import { mapBlocksToCommands } from './CommandMapper';
import { validateCommandSequence } from './SequenceValidator';
import type { ParseIssue, ParseResult, RawBlock, RawValueBlock, RawValueInput } from './types';

export const BLOCKLY_XML_NAMESPACE = 'https://developers.google.com/blockly/xml';

export const PARSER_LIMITS = {
  /** Robolink exports are a few KB; 256 KB leaves lots of headroom. */
  maxFileBytes: 256 * 1024,
  /** Total XML elements in the document. */
  maxElements: 5_000,
  /** Executable blocks in the program stack. */
  maxBlocks: 500,
} as const;

/** Top-level elements that may legitimately appear next to the program. */
const IGNORED_TOP_LEVEL = new Set(['comment']);

/** Children of a statement block that carry no behaviour. */
const IGNORED_BLOCK_CHILDREN = new Set(['comment', 'data']);

function issue(
  code: ParseIssue['code'],
  message: string,
  blockId: string | null = null,
  blockType: string | null = null,
): ParseIssue {
  return { code, message, blockId, blockType };
}

function childElements(el: Element): Element[] {
  return Array.from(el.children);
}

/** Blockly elements may be namespaced (xmlns) or not; accept both. */
function isBlocklyElement(el: Element, localName: string): boolean {
  return (
    el.localName === localName &&
    (el.namespaceURI === BLOCKLY_XML_NAMESPACE || el.namespaceURI === null)
  );
}

function isDisabled(el: Element): boolean {
  if (el.getAttribute('disabled') === 'true') return true;
  // Newer Blockly versions record why a block is disabled instead.
  const reasons = el.getAttribute('disabled-reasons');
  return reasons !== null && reasons.trim() !== '';
}

function readFields(el: Element): Map<string, string> {
  const fields = new Map<string, string>();
  for (const child of childElements(el)) {
    if (!isBlocklyElement(child, 'field')) continue;
    const name = child.getAttribute('name');
    if (name !== null) fields.set(name, (child.textContent ?? '').trim());
  }
  return fields;
}

function readValueBlock(el: Element, kind: RawValueBlock['kind']): RawValueBlock {
  const hasNestedContent = childElements(el).some((child) => child.localName !== 'field');
  return {
    kind,
    type: el.getAttribute('type') ?? '',
    id: el.getAttribute('id'),
    fields: readFields(el),
    hasNestedContent,
  };
}

function readValueInput(el: Element): RawValueInput | { error: string } {
  let shadow: RawValueBlock | null = null;
  let block: RawValueBlock | null = null;
  for (const child of childElements(el)) {
    if (isBlocklyElement(child, 'shadow') && shadow === null) {
      shadow = readValueBlock(child, 'shadow');
    } else if (isBlocklyElement(child, 'block') && block === null) {
      block = readValueBlock(child, 'block');
    } else {
      return { error: `unexpected <${child.localName}> inside a value input` };
    }
  }
  return { shadow, block };
}

interface ReadStackResult {
  blocks: RawBlock[];
  issues: ParseIssue[];
}

/**
 * Walks a top-level block and its `<next>` chain iteratively (so very long
 * programs cannot overflow the call stack).
 */
function readStack(first: Element): ReadStackResult {
  const blocks: RawBlock[] = [];
  const issues: ParseIssue[] = [];
  let current: Element | null = first;

  while (current !== null) {
    if (blocks.length >= PARSER_LIMITS.maxBlocks) {
      issues.push(
        issue(
          'TOO_COMPLEX',
          `This program has more than ${PARSER_LIMITS.maxBlocks} blocks, which is more than the simulator supports.`,
        ),
      );
      break;
    }

    const type = current.getAttribute('type') ?? '';
    const id = current.getAttribute('id');
    const fields = readFields(current);
    const values = new Map<string, RawValueInput>();
    const statements: string[] = [];
    const unexpectedChildren: string[] = [];
    let next: Element | null = null;

    for (const child of childElements(current)) {
      if (isBlocklyElement(child, 'field')) continue;
      if (isBlocklyElement(child, 'value')) {
        const name = child.getAttribute('name') ?? '';
        const input = readValueInput(child);
        if ('error' in input) {
          issues.push(
            issue('UNEXPECTED_STRUCTURE', `The "${type}" block has an ${input.error}.`, id, type),
          );
        } else {
          values.set(name, input);
        }
      } else if (isBlocklyElement(child, 'statement')) {
        statements.push(child.getAttribute('name') ?? '');
      } else if (isBlocklyElement(child, 'next')) {
        const nextChildren = childElements(child);
        const nextBlock = nextChildren[0];
        if (nextChildren.length > 1 || (nextBlock && !isBlocklyElement(nextBlock, 'block'))) {
          issues.push(
            issue(
              'UNEXPECTED_STRUCTURE',
              `The block after "${type}" is not connected in a way the simulator understands.`,
              id,
              type,
            ),
          );
        } else if (nextBlock) {
          next = nextBlock;
        }
      } else if (!IGNORED_BLOCK_CHILDREN.has(child.localName)) {
        unexpectedChildren.push(child.localName);
      }
    }

    blocks.push({
      type,
      id,
      disabled: isDisabled(current),
      fields,
      values,
      statements,
      unexpectedChildren,
    });
    current = next;
  }

  return { blocks, issues };
}

/**
 * Parses Robolink Blockly XML text into drone commands.
 *
 * Fatal problems are returned as `errors`; a program that parses but has a
 * questionable flight order (e.g. never lands) is returned with `warnings`.
 */
export function parseRobolinkXml(xmlText: string): ParseResult {
  const byteLength = new TextEncoder().encode(xmlText).length;
  if (byteLength > PARSER_LIMITS.maxFileBytes) {
    return fail(
      issue(
        'FILE_TOO_LARGE',
        `This file is ${(byteLength / 1024).toFixed(0)} KB. Blockly programs are much smaller — the limit is ${PARSER_LIMITS.maxFileBytes / 1024} KB. Is this the right file?`,
      ),
    );
  }
  if (xmlText.trim() === '') {
    return fail(issue('MALFORMED_XML', 'The file is empty.'));
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  } catch {
    return fail(issue('MALFORMED_XML', 'The file could not be read as XML.'));
  }

  if (doc.getElementsByTagName('parsererror').length > 0) {
    return fail(
      issue(
        'MALFORMED_XML',
        'This file is not valid XML. Download the program again from Robolink Blockly and upload the new file.',
      ),
    );
  }
  // DTDs can define entity bombs and are never produced by Blockly.
  if (doc.doctype !== null) {
    return fail(issue('FORBIDDEN_DOCTYPE', 'This XML file contains a DOCTYPE, which Blockly files never do.'));
  }
  if (doc.getElementsByTagName('*').length > PARSER_LIMITS.maxElements) {
    return fail(issue('TOO_COMPLEX', 'This XML file is too large or complex for the simulator.'));
  }

  const root = doc.documentElement;
  if (!isBlocklyElement(root, 'xml')) {
    return fail(
      issue(
        'NOT_BLOCKLY_XML',
        'This does not look like a Blockly program. Use "Download" in Robolink Blockly to get the .xml file.',
      ),
    );
  }

  const errors: ParseIssue[] = [];
  const stacks: Element[] = [];
  for (const child of childElements(root)) {
    if (isBlocklyElement(child, 'block')) {
      stacks.push(child);
    } else if (isBlocklyElement(child, 'variables')) {
      if (child.children.length > 0) {
        errors.push(
          issue('UNSUPPORTED_FEATURE', 'Variables are not supported by the simulator yet. Remove them and try again.'),
        );
      }
    } else if (!IGNORED_TOP_LEVEL.has(child.localName)) {
      errors.push(
        issue('UNEXPECTED_STRUCTURE', `The file contains an unexpected <${child.localName}> element.`),
      );
    }
  }

  if (stacks.length === 0 && errors.length === 0) {
    return fail(issue('EMPTY_PROGRAM', 'The program is empty. Add some blocks in Robolink Blockly first.'));
  }
  if (stacks.length > 1) {
    // With several loose stacks we cannot know which one the student meant to fly.
    errors.push(
      issue(
        'MULTIPLE_PROGRAMS',
        `The workspace has ${stacks.length} separate groups of blocks. Connect all blocks into one stack (or delete the extras) so the drone knows which to run.`,
      ),
    );
  }
  if (errors.length > 0) return { ok: false, errors };

  const [firstStack] = stacks;
  if (!firstStack) {
    return fail(issue('EMPTY_PROGRAM', 'The program is empty. Add some blocks in Robolink Blockly first.'));
  }
  const stack = readStack(firstStack);
  const mapped = mapBlocksToCommands(stack.blocks);
  const allErrors = [...stack.issues, ...mapped.errors];
  if (allErrors.length > 0) return { ok: false, errors: allErrors };

  return { ok: true, commands: mapped.commands, warnings: validateCommandSequence(mapped.commands) };
}

function fail(error: ParseIssue): ParseResult {
  return { ok: false, errors: [error] };
}
