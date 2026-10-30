import { PLAYBACK_SPEEDS } from '../hooks/useSimulation';
import type { PlaybackPhase, PlaybackSpeed } from '../hooks/useSimulation';
import { Icon } from './Icon';

interface Props {
  readonly phase: PlaybackPhase;
  readonly canRun: boolean;
  /** Run was pressed and the camera is on its way to the drone. */
  readonly launching: boolean;
  readonly speed: PlaybackSpeed;
  readonly elapsed: number;
  readonly total: number;
  readonly statusLabel: string;
  readonly statusTone: 'idle' | 'live' | 'ok' | 'error';
  readonly currentCommand: string;
  readonly onRun: () => void;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onReset: () => void;
  readonly onSpeedChange: (speed: PlaybackSpeed) => void;
}

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Run / pause / reset, playback progress and speed. */
export function TransportBar(props: Props) {
  const { phase, canRun, launching, speed, elapsed, total, statusLabel, statusTone, currentCommand } = props;
  const { onRun, onPause, onResume, onReset, onSpeedChange } = props;
  const progress = total > 0 ? Math.min(1, elapsed / total) : 0;

  return (
    <div className="transport" role="group" aria-label="Simulation controls">
      <div className="transport__buttons">
        {phase === 'running' ? (
          <button type="button" className="btn btn--dark btn--lg" onClick={onPause}>
            <Icon name="pause" /> Pause
          </button>
        ) : phase === 'paused' ? (
          <button type="button" className="btn btn--primary btn--lg" onClick={onResume}>
            <Icon name="play" /> Resume
          </button>
        ) : (
          <button type="button" className="btn btn--primary btn--lg" onClick={onRun} disabled={!canRun}>
            <Icon name="play" /> {launching ? 'Starting…' : phase === 'finished' ? 'Run again' : 'Run simulation'}
          </button>
        )}
        <button type="button" className="btn btn--secondary btn--lg btn--icon-text" onClick={onReset} disabled={phase === 'idle' && !launching}>
          <Icon name="reset" /> Reset
        </button>
      </div>

      <div className="transport__progress">
        <div className="transport__labels">
          <span className={`status-pill status-pill--${statusTone}`} data-testid="telemetry-status">
            {statusLabel}
          </span>
          <span className="transport__command" data-testid="telemetry-command">
            {currentCommand}
          </span>
          <span className="transport__time">
            {clock(elapsed)} / {clock(total)}
          </span>
        </div>
        <div
          className="progress"
          role="progressbar"
          aria-label="Flight progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <div className={`progress__fill progress__fill--${statusTone}`} style={{ transform: `scaleX(${progress})` }} />
        </div>
      </div>

      <div className="segmented segmented--sm" role="radiogroup" aria-label="Playback speed">
        {PLAYBACK_SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={s === speed}
            className="segmented__option"
            onClick={() => onSpeedChange(s)}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
