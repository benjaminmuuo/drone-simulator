/**
 * Static checks on the order of flight commands. These are reported as
 * warnings at import time so students can still run the program and watch
 * where it goes wrong; the simulation engine enforces the same rules.
 */
import { describeCommand } from './describeCommand';
import type { DroneCommand, ParseIssue } from './types';

export function validateCommandSequence(commands: readonly DroneCommand[]): ParseIssue[] {
  const warnings: ParseIssue[] = [];
  let flying = false;

  commands.forEach((command, index) => {
    const step = `Step ${index + 1} (${describeCommand(command)})`;
    const warn = (message: string) =>
      warnings.push({ code: 'INVALID_SEQUENCE', message, blockId: command.blockId, blockType: null });

    switch (command.type) {
      case 'TAKEOFF':
        if (flying) warn(`${step}: the drone is already flying.`);
        flying = true;
        break;
      case 'LAND':
        if (!flying) warn(`${step}: the drone is not flying, so it cannot land.`);
        flying = false;
        break;
      default:
        if (!flying) warn(`${step}: the drone must take off first.`);
    }
  });

  if (commands.length > 0 && flying) {
    warnings.push({
      code: 'INVALID_SEQUENCE',
      message: 'The program ends while the drone is still flying. Add a Land block at the end.',
      blockId: null,
      blockType: null,
    });
  }
  return warnings;
}
