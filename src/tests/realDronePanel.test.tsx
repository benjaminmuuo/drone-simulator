import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app/App';
import { EXAMPLE_PROGRAM_XML, STARTER_PROGRAM_XML } from '../blocks/robolinkBlocks';
import { RealDronePanel } from '../components/RealDronePanel';
import type { RealDroneController, RealFlight } from '../hardware/useRealDrone';
import type { DroneCommand } from '../parser/types';
import { editor } from './editorMock';

vi.mock('../components/BlocklyEditor', () => import('./editorMock'));

/** What the App's useRealDrone() returns in these tests. */
let fakeDrone: RealDroneController;
vi.mock('../hardware/useRealDrone', () => ({ useRealDrone: () => fakeDrone }));

const PROGRAM: readonly DroneCommand[] = [
  { type: 'TAKEOFF', blockId: 'b1' },
  { type: 'MOVE', direction: 'FORWARD', distanceCm: 50, blockId: 'b2' },
  { type: 'LAND', blockId: 'b3' },
];

function controller(overrides: Partial<RealDroneController> = {}): RealDroneController {
  return {
    supported: true,
    connection: 'connected',
    connectError: null,
    status: { system: 'Running', flight: 'Ready', movement: 'Ready', battery: 88 },
    answering: true,
    flight: { phase: 'idle' },
    preflight: () => [],
    connect: vi.fn(),
    disconnect: vi.fn(),
    fly: vi.fn(),
    land: vi.fn(),
    stop: vi.fn(),
    dismissResult: vi.fn(),
    ...overrides,
  };
}

const flying = (activeIndex: number | null): RealFlight => ({ phase: 'flying', commands: PROGRAM, activeIndex, landing: false });

function panel(drone: RealDroneController, blockers: string[] = [], onShowBlock = vi.fn()) {
  render(<RealDronePanel drone={drone} commands={PROGRAM} blockers={blockers} onShowBlock={onShowBlock} />);
  return onShowBlock;
}

const flyButton = () => screen.getByRole('button', { name: /Fly real drone/ });

describe('RealDronePanel', () => {
  it('explains which browsers can fly when Web Serial is missing', () => {
    panel(controller({ supported: false, connection: 'disconnected' }));
    expect(screen.getByText(/needs Chrome, Edge or Brave/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect/ })).not.toBeInTheDocument();
  });

  it('offers Connect when disconnected, and shows connection errors', () => {
    const drone = controller({ connection: 'disconnected', status: null, connectError: 'The controller was unplugged.' });
    panel(drone);
    fireEvent.click(screen.getByRole('button', { name: /Connect drone/ }));
    expect(drone.connect).toHaveBeenCalled();
    expect(screen.getByText('The controller was unplugged.')).toBeInTheDocument();
    expect(screen.getByTestId('real-drone-status')).toHaveTextContent('Not connected');
  });

  it('shows battery and keeps Fly disabled with the reasons', () => {
    panel(controller({ preflight: () => ['The battery is at 20%.'] }), ['This program fails in the simulator.']);
    expect(screen.getByText(/88%/)).toBeInTheDocument();
    expect(flyButton()).toBeDisabled();
    const reasons = within(screen.getByTestId('real-drone-reasons')).getAllByRole('listitem');
    expect(reasons.map((r) => r.textContent)).toEqual(['This program fails in the simulator.', 'The battery is at 20%.']);
  });

  it('asks for the safety checklist before flying', () => {
    const drone = controller();
    panel(drone);
    fireEvent.click(flyButton());
    expect(drone.fly).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Before you fly' })).toHaveTextContent(/area is clear/);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Before you fly' })).not.toBeInTheDocument();

    fireEvent.click(flyButton());
    fireEvent.click(screen.getByRole('button', { name: /Fly now/ }));
    expect(drone.fly).toHaveBeenCalledWith(PROGRAM);
  });

  it('shows the current block, STOP and Land now while flying', () => {
    const drone = controller({ flight: flying(1) });
    panel(drone);
    expect(screen.getByTestId('real-drone-status')).toHaveTextContent('Flying');
    expect(screen.getByText(/2\. Forward — 50 cm/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /STOP/ }));
    expect(drone.stop).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Land now/ }));
    expect(drone.land).toHaveBeenCalled();
  });

  it('reports a failed flight and links to the block', () => {
    const onShowBlock = panel(
      controller({
        flight: { phase: 'done', commands: PROGRAM, outcome: { status: 'FAILED', message: 'The drone did not start the move.', commandIndex: 1 } },
      }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Stopped at block 2 (Forward — 50 cm): The drone did not start the move.');
    fireEvent.click(screen.getByRole('button', { name: 'Show block' }));
    expect(onShowBlock).toHaveBeenCalledWith('b2');
  });
});

describe('App with a real drone', () => {
  beforeEach(() => editor.reset());

  async function appWith(xml: string, drone: RealDroneController) {
    fakeDrone = drone;
    const view = render(<App />);
    await waitFor(() => expect(editor.props).not.toBeNull());
    act(() => editor.props!.onChange(xml, 'edit'));
    return view;
  }

  it('only lets a program that passes the simulation fly', async () => {
    const view = await appWith(STARTER_PROGRAM_XML, controller());
    // Take off → land misses the landing pad on the Beginner Course.
    expect(flyButton()).toBeDisabled();
    expect(screen.getByTestId('real-drone-reasons')).toHaveTextContent(/fails in the simulator/);

    act(() => editor.props!.onChange(EXAMPLE_PROGRAM_XML, 'edit'));
    view.rerender(<App />);
    expect(flyButton()).toBeEnabled();
  });

  it('highlights the block being flown and disables the simulator Run', async () => {
    const view = await appWith(EXAMPLE_PROGRAM_XML, controller());
    fakeDrone = controller({
      flight: { phase: 'flying', commands: PROGRAM, activeIndex: 1, landing: false },
    });
    view.rerender(<App />);
    expect(editor.props!.activeBlockId).toBe('b2');
    expect(screen.getByRole('button', { name: /Run simulation/ })).toBeDisabled();
  });
});
