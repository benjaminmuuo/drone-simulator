import { useEffect, useState } from 'react';
import type { RealDroneController } from '../hardware/useRealDrone';
import { RUNNER_LIMITS } from '../hardware/DroneRunner';
import type { RunOutcome } from '../hardware/DroneRunner';
import { describeCommand } from '../parser/describeCommand';
import type { DroneCommand } from '../parser/types';
import { Icon } from './Icon';

interface Props {
  readonly drone: RealDroneController;
  /** The program to fly (null when there is none). */
  readonly commands: readonly DroneCommand[] | null;
  /** Reasons, from the app side, not to fly yet (e.g. the simulation fails). */
  readonly blockers: readonly string[];
  readonly onShowBlock: ((blockId: string) => void) | null;
}

type Tone = 'idle' | 'live' | 'ok' | 'error';

function pill(drone: RealDroneController): [string, Tone] {
  if (drone.flight.phase === 'flying') return [drone.flight.landing ? 'Landing…' : 'Flying', 'live'];
  if (drone.connection === 'connecting') return ['Connecting…', 'live'];
  if (drone.connection === 'disconnected') return ['Not connected', 'idle'];
  if (!drone.answering) return ['Drone not answering', 'error'];
  return ['Drone ready', 'ok'];
}

function Outcome({ outcome, commands, onShowBlock }: { outcome: RunOutcome; commands: readonly DroneCommand[]; onShowBlock: Props['onShowBlock'] }) {
  if (outcome.status === 'COMPLETED')
    return (
      <p className="real-drone__result real-drone__result--ok" role="status">
        <Icon name="check" /> Real flight complete. Did it land where the simulator said it would?
      </p>
    );
  if (outcome.status === 'ABORTED')
    return (
      <p className="real-drone__result" role="status">
        <Icon name="land" /> Flight ended early: the drone landed.
      </p>
    );
  if (outcome.status === 'STOPPED')
    return (
      <p className="real-drone__result real-drone__result--error" role="status">
        <Icon name="stop" /> Emergency stop: the motors were cut. Check the drone for damage before flying again.
      </p>
    );
  const block = outcome.commandIndex !== null ? commands[outcome.commandIndex] : undefined;
  return (
    <div className="real-drone__result real-drone__result--error" role="alert">
      <Icon name="alert" />
      <span>
        {block ? `Stopped at block ${outcome.commandIndex! + 1} (${describeCommand(block)}): ` : ''}
        {outcome.message}
      </span>
      {block?.blockId && onShowBlock && (
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => onShowBlock(block.blockId!)}>
          Show block
        </button>
      )}
    </div>
  );
}

/** Connect a real CoDrone EDU over USB and fly the program on it. */
export function RealDronePanel({ drone, commands, blockers, onShowBlock }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [label, tone] = pill(drone);
  const { flight, status } = drone;
  const connected = drone.connection === 'connected';
  const flying = flight.phase === 'flying';

  const reasons = [...blockers, ...(commands && connected ? drone.preflight(commands) : [])];
  const canFly = connected && !flying && commands !== null && reasons.length === 0;

  // Anything that makes the program unflyable also closes the checklist.
  useEffect(() => {
    if (!canFly) setConfirming(false);
  }, [canFly]);

  const active = flying && flight.activeIndex !== null ? flight.commands[flight.activeIndex] : undefined;

  return (
    <section className="real-drone" aria-labelledby="real-drone-title" data-testid="real-drone">
      <header className="real-drone__header">
        <h3 id="real-drone-title" className="real-drone__title">
          <Icon name="plug" /> Real drone
        </h3>
        <span className={`status-pill status-pill--${tone}`} data-testid="real-drone-status">
          {label}
        </span>
        {connected && status && (
          <span className={`real-drone__battery${status.battery < RUNNER_LIMITS.minBattery ? ' real-drone__battery--low' : ''}`} title="Drone battery">
            <Icon name="battery" /> {status.battery}%
          </span>
        )}
        {connected && !flying && (
          <button type="button" className="btn btn--ghost btn--sm real-drone__disconnect" onClick={drone.disconnect}>
            Disconnect
          </button>
        )}
      </header>

      {!drone.supported ? (
        <p className="real-drone__text">
          Flying a real drone needs Chrome, Edge or Brave on a computer. You can still <strong>Download</strong> your program and fly
          it from Robolink Blockly.
        </p>
      ) : drone.connection !== 'connected' ? (
        <div className="real-drone__row">
          <p className="real-drone__text">Plug the controller into this computer with USB, and turn the drone on.</p>
          <button type="button" className="btn btn--secondary" onClick={drone.connect} disabled={drone.connection === 'connecting'}>
            <Icon name="plug" /> Connect drone
          </button>
        </div>
      ) : flying ? (
        <div className="real-drone__row">
          <p className="real-drone__text" aria-live="polite">
            {active ? `${flight.activeIndex! + 1}. ${describeCommand(active)}` : 'Starting…'}
            <span className="real-drone__keys">Space = STOP</span>
          </p>
          <button type="button" className="btn btn--secondary" onClick={drone.land} disabled={flight.landing}>
            <Icon name="land" /> Land now
          </button>
          <button type="button" className="btn btn--stop btn--lg" onClick={drone.stop}>
            <Icon name="stop" /> STOP
          </button>
        </div>
      ) : confirming ? (
        <div className="real-drone__confirm" role="group" aria-label="Before you fly">
          <strong>Before you fly</strong>
          <ul>
            <li>The flying area is clear, and everyone is standing back.</li>
            <li>The drone is on its start mark, with its front facing the right way.</li>
            <li>
              <strong>Space</strong> or <strong>STOP</strong> cuts the motors at once. <strong>Land now</strong> lands gently.
            </li>
          </ul>
          <div className="real-drone__row">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                setConfirming(false);
                if (commands) drone.fly(commands);
              }}
            >
              <Icon name="play" /> Fly now
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="real-drone__row">
          {reasons.length > 0 ? (
            <ul className="real-drone__reasons" data-testid="real-drone-reasons">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : (
            <p className="real-drone__text">The simulation passed. Ready to fly it for real.</p>
          )}
          <button type="button" className="btn btn--primary" onClick={() => setConfirming(true)} disabled={!canFly}>
            <Icon name="play" /> Fly real drone
          </button>
        </div>
      )}

      {drone.connectError && !connected && <p className="real-drone__result real-drone__result--error">{drone.connectError}</p>}
      {flight.phase === 'done' && !confirming && (
        <Outcome outcome={flight.outcome} commands={flight.commands} onShowBlock={onShowBlock} />
      )}
    </section>
  );
}
