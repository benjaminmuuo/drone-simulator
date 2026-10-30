import type { Pose } from '../animation/timeline';
import { normalizeHeading } from '../engine/MovementEngine';

interface Props {
  readonly pose: Pose;
  readonly flightLabel: string;
}

/** Live drone readout overlaid on the 3D view, like an instrument panel. */
export function FlightHud({ pose, flightLabel }: Props) {
  const rows: Array<[label: string, id: string, value: string]> = [
    ['X', 'x', `${pose.x.toFixed(1)} cm`],
    ['Y', 'y', `${pose.y.toFixed(1)} cm`],
    ['Heading', 'heading', `${normalizeHeading(Math.round(pose.headingDeg))}°`],
    ['Drone', 'flight', flightLabel],
  ];
  return (
    <dl className="hud-telemetry glass" aria-label="Telemetry">
      {rows.map(([label, id, value]) => (
        <div key={id} className="hud-telemetry__item">
          <dt>{label}</dt>
          <dd data-testid={`telemetry-${id}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
