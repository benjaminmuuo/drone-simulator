import { describeCommand } from '../parser/describeCommand';
import type { DroneCommand } from '../parser/types';
import { Icon } from './Icon';
import type { IconName } from './Icon';

interface Props {
  readonly commands: readonly DroneCommand[];
  /** Command currently playing, or null when idle. */
  readonly activeIndex: number | null;
  readonly completedCount: number;
  readonly failedIndex: number | null;
}

const ICONS: Record<DroneCommand['type'], IconName> = {
  TAKEOFF: 'up',
  LAND: 'down',
  HOVER: 'clock',
  MOVE: 'arrow',
  TURN: 'rotate',
};

/** The program as the simulator understood it, step by step, with live progress. */
export function FlightPlan({ commands, activeIndex, completedCount, failedIndex }: Props) {
  return (
    <section className="card plan-card" aria-labelledby="plan-title">
      <header className="card__header card__header--compact">
        <h2 id="plan-title" className="card__title">
          Flight plan
        </h2>
        <span className="card__meta">{commands.length > 0 ? `${commands.length} steps` : ''}</span>
      </header>
      {commands.length === 0 ? (
        <p className="empty">Your blocks will appear here as a list of steps.</p>
      ) : (
        <ol className="plan" aria-label="Interpreted program">
          {commands.map((command, index) => {
            const state =
              index === failedIndex && completedCount > index
                ? 'failed'
                : index === activeIndex
                  ? 'active'
                  : index < completedCount
                    ? 'done'
                    : 'pending';
            return (
              <li
                key={`${index}-${command.blockId ?? ''}`}
                className={`plan__item plan__item--${state} plan__item--${command.type.toLowerCase()}`}
                aria-current={state === 'active' ? 'step' : undefined}
                data-state={state}
                title={command.blockId ? `Blockly block ID: ${command.blockId}` : undefined}
              >
                <span className="plan__num">{index + 1}</span>
                <span className="plan__icon">
                  <Icon name={ICONS[command.type]} size={14} />
                </span>
                <span className="program__label plan__label">{describeCommand(command)}</span>
                <span className="plan__state" aria-hidden="true">
                  {state === 'done' && <Icon name="check" size={15} />}
                  {state === 'failed' && <Icon name="error" size={15} />}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
