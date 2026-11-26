import type { DroneCommand } from './types';

const DIRECTION_WORDS = {
  FORWARD: 'Forward',
  BACKWARD: 'Backward',
  LEFT: 'Left',
  RIGHT: 'Right',
  UP: 'Up',
  DOWN: 'Down',
} as const;

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/** Short, student-readable label, e.g. "Forward — 50 cm". */
export function describeCommand(command: DroneCommand): string {
  switch (command.type) {
    case 'TAKEOFF':
      return 'Takeoff';
    case 'LAND':
      return 'Land';
    case 'HOVER': {
      const s = command.durationSeconds;
      return `Hover — ${formatNumber(s)} ${s === 1 ? 'second' : 'seconds'}`;
    }
    case 'MOVE':
      return `${DIRECTION_WORDS[command.direction]} — ${formatNumber(command.distanceCm)} cm`;
    case 'VERTICAL':
      return `${DIRECTION_WORDS[command.direction]} — ${formatNumber(command.distanceCm)} cm`;
    case 'TURN':
      return `Turn ${command.direction.toLowerCase()} — ${formatNumber(command.degrees)}°`;
  }
}
