import type { FailureKind, SimulationResult } from '../engine/types';
import { Icon } from './Icon';

const TITLES: Record<FailureKind, string> = {
  COLLISION_OBSTACLE: 'Crash! The drone hit an obstacle',
  NO_FLY_ZONE: 'Restricted area! The drone entered a red no-fly zone',
  OUT_OF_BOUNDS: 'Out of bounds! The drone left the arena',
  NOT_FLYING: 'Take off first!',
  ALREADY_FLYING: 'The drone is already in the air',
  NOT_LANDED: "The drone didn't land",
  LANDED_OUTSIDE_ZONE: 'Missed the landing zone',
  CHECKPOINT_MISSED: 'A checkpoint was missed',
  EMPTY_PROGRAM: 'Nothing to run',
};

const TIPS: Record<FailureKind, string> = {
  COLLISION_OBSTACLE: 'Try a shorter distance, turn earlier, or check the flight height.',
  NO_FLY_ZONE: 'Plan a route that goes around the red area.',
  OUT_OF_BOUNDS: 'Check your distances: the arena is smaller than you think!',
  NOT_FLYING: 'Put a "take off" block before any movement.',
  ALREADY_FLYING: 'Remove the extra "take off" block, or land first.',
  NOT_LANDED: 'Finish your program with a "land" block.',
  LANDED_OUTSIDE_ZONE: 'Adjust your moves so the drone ends over the green H pad.',
  CHECKPOINT_MISSED: 'Make sure your route passes over every checkpoint cone.',
  EMPTY_PROGRAM: 'Add some blocks to your program.',
};

interface Props {
  readonly result: SimulationResult;
  /** Jump to the failing block in the editor; null when unavailable. */
  readonly onShowBlock: ((blockId: string) => void) | null;
}

export function MissionFeedback({ result, onShowBlock }: Props) {
  const { failure } = result;
  if (!failure) {
    return (
      <div className="result result--success" role="alert">
        <span className="result__icon">
          <Icon name="check" size={22} />
        </span>
        <div className="result__body">
          <strong className="result__title">Mission complete!</strong>
          <p>The drone followed your program and landed safely in the landing zone.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="result result--failure" role="alert">
      <span className="result__icon">
        <Icon name="alert" size={22} />
      </span>
      <div className="result__body">
        <strong className="result__title">{TITLES[failure.kind]}</strong>
        <p>{failure.message}</p>
        <p className="result__tip">Tip: {TIPS[failure.kind]}</p>
        {failure.blockId && !onShowBlock && (
          <p className="result__id">
            Blockly block ID: <code>{failure.blockId}</code>
          </p>
        )}
      </div>
      {failure.blockId && onShowBlock && (
        <button type="button" className="btn btn--secondary btn--sm result__action" onClick={() => onShowBlock(failure.blockId!)} title={`Block ID ${failure.blockId}`}>
          Show block
        </button>
      )}
    </div>
  );
}
