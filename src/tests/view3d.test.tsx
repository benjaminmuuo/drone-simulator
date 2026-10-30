import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraMode, CameraNudge, DroneWorldOptions, FollowView, WorldSnapshot } from '../three/createDroneWorld';

// jsdom has no WebGL: pretend it does, and replace the three.js world with a recorder.
const world = vi.hoisted(() => ({
  snapshots: [] as WorldSnapshot[],
  cameraModes: [] as CameraMode[],
  followViews: [] as FollowView[],
  flightHeights: [] as number[],
  measureModes: [] as boolean[],
  nudges: [] as CameraNudge[],
  cleared: 0,
  themes: [] as string[],
  options: null as DroneWorldOptions | null,
  grid: [] as boolean[],
  disposed: 0,
  fail: false,
}));

vi.mock('../three/supportsWebGL', () => ({ supportsWebGL: () => true }));
vi.mock('../components/BlocklyEditor', () => import('./editorMock'));
vi.mock('../three/createDroneWorld', () => ({
  createDroneWorld: (_container: HTMLElement, _maze: unknown, options: DroneWorldOptions) => {
    if (world.fail) throw new Error('WebGL context lost');
    world.themes.push(options.theme);
    world.options = options;
    return {
      setFlightHeight: (h: number) => world.flightHeights.push(h),
      setMeasureMode: (on: boolean) => world.measureModes.push(on),
      clearMeasurement: () => {
        world.cleared++;
      },
      nudgeCamera: (action: CameraNudge) => world.nudges.push(action),
      setSnapshot: (s: WorldSnapshot) => world.snapshots.push(s),
      setCameraMode: (m: CameraMode) => world.cameraModes.push(m),
      setFollowView: (v: FollowView) => world.followViews.push(v),
      setShowGrid: (g: boolean) => world.grid.push(g),
      dispose: () => {
        world.disposed++;
      },
    };
  },
}));

const { App, LAUNCH_DELAY_MS } = await import('../app/App');
const fixture = readFileSync(resolve(__dirname, 'fixtures/main.xml'), 'utf8');

beforeEach(() => {
  Object.assign(world, { snapshots: [], cameraModes: [], followViews: [], flightHeights: [], measureModes: [], nudges: [], cleared: 0, themes: [], options: null, grid: [], disposed: 0, fail: false });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('3D view', () => {
  it('is the default view when WebGL is available', async () => {
    render(<App />);
    expect(await screen.findByTestId('maze-3d')).toBeInTheDocument();
    expect(screen.queryByTestId('obstacle')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Overview' })).toHaveAttribute('aria-checked', 'true');
    // The world is configured in effects that can run just after the lazy view mounts.
    await waitFor(() => expect(world.cameraModes.length).toBeGreaterThan(0));
    expect(new Set(world.cameraModes)).toEqual(new Set(['orbit']));
  });

  it('streams playback snapshots to the 3D world', async () => {
    render(<App />);
    await screen.findByTestId('maze-3d');
    await userEvent.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, new File([fixture], 'main.xml'));
    await screen.findByText(/Program imported/);

    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] });
    fireEvent.click(screen.getByRole('button', { name: /Run simulation/ }));

    // Run first brings the camera to the drone on its start mark, then takes off.
    expect(world.cameraModes.at(-1)).toBe('follow');
    expect(screen.getByRole('button', { name: /Starting/ })).toBeDisabled();
    expect(screen.getByTestId('telemetry-status')).toHaveTextContent('Getting ready');
    act(() => {
      vi.advanceTimersByTime(LAUNCH_DELAY_MS - 50);
    });
    expect(world.snapshots.at(-1)!.phase).toBe('idle');
    act(() => {
      vi.advanceTimersByTime(100); // camera has arrived: take off
    });
    expect(world.snapshots.at(-1)!.phase).toBe('running');
    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    const last = world.snapshots.at(-1)!;
    expect(last.phase).toBe('finished');
    expect(last.timeline.segments).toHaveLength(8);
    expect(last.elapsed).toBeCloseTo(last.timeline.totalSeconds, 6);
    expect([...last.visitedCheckpoints]).toEqual(['flag']);
    expect(screen.getByRole('alert')).toHaveTextContent('Mission complete!');
  });

  it('switches camera modes and grid', async () => {
    render(<App />);
    await screen.findByTestId('maze-3d');
    await waitFor(() => expect(world.cameraModes.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('radio', { name: 'Follow drone' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Top-down' }));
    fireEvent.click(screen.getByRole('switch', { name: /Grid/ }));
    expect(world.cameraModes.slice(-2)).toEqual(['follow', 'top']);
    expect(world.grid.at(-1)).toBe(false);
  });

  it('swings the follow camera to a side of the drone', async () => {
    render(<App />);
    await screen.findByTestId('maze-3d');
    await waitFor(() => expect(world.cameraModes.length).toBeGreaterThan(0));
    // The side views appear once the camera follows the drone.
    expect(screen.queryByRole('radiogroup', { name: 'View the drone from' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Follow drone' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Right side' }));
    expect(world.followViews.at(-1)).toBe('right');
    expect(world.cameraModes.at(-1)).toBe('follow');
    expect(screen.getByRole('radio', { name: 'Follow drone' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Right side' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('radio', { name: 'Front' }));
    expect(world.followViews.at(-1)).toBe('front');
    expect(screen.getByRole('radio', { name: 'Right side' })).toHaveAttribute('aria-checked', 'false');
  });

  it('there is no 2D map', async () => {
    render(<App />);
    await screen.findByTestId('maze-3d');
    expect(screen.queryByRole('radio', { name: '2D map' })).not.toBeInTheDocument();
  });

  it('explains the problem if the 3D world fails to start', async () => {
    world.fail = true;
    render(<App />);
    expect(await screen.findByText(/3D view could not start/)).toBeInTheDocument();
    expect(screen.queryByTestId('maze-3d')).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Camera' })).not.toBeInTheDocument();
  });

  it('starts in the classroom and can switch to the forest', async () => {
    render(<App />);
    await screen.findByTestId('maze-3d');
    await waitFor(() => expect(world.themes).toContain('classroom'));
    fireEvent.click(screen.getByRole('radio', { name: 'Forest' }));
    await waitFor(() => expect(world.themes.at(-1)).toBe('forest'));
    expect(world.disposed).toBeGreaterThan(0);
  });

  it('passes the flight height to the 3D world and the simulation', async () => {
    render(<App />);
    await screen.findByTestId('maze-3d');
    await waitFor(() => expect(world.flightHeights).toContain(80));
    fireEvent.change(screen.getByRole('combobox', { name: /Flight height/ }), { target: { value: '40' } });
    expect(world.flightHeights.at(-1)).toBe(40);
    expect(screen.getByText(/flies over boxes lower than/)).toHaveTextContent('lower than 30 cm');
  });

  it('measures between two points', async () => {
    render(<App />);
    await screen.findByTestId('maze-3d');
    await waitFor(() => expect(world.options).not.toBeNull());
    fireEvent.click(screen.getByRole('radio', { name: 'Follow drone' }));
    const button = screen.getByRole('button', { name: /Measure/ });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(world.measureModes.at(-1)).toBe(true);
    // Measuring happens on the top-down floor plan.
    expect(world.cameraModes.at(-1)).toBe('top');
    expect(screen.getByText(/Click the first point/)).toBeInTheDocument();

    const a = { point: { x: 0, y: 0, heightCm: 0 }, label: 'arena corner' };
    const b = { point: { x: 100, y: 110, heightCm: 0 }, label: 'corner of Box wall' };
    act(() => world.options!.onMeasure!({ first: a, result: null }));
    expect(screen.getByText(/From arena corner \(x 0, y 0\)\. Now click the second point\./)).toBeInTheDocument();
    act(() =>
      world.options!.onMeasure!({
        first: null,
        result: { a, b, distanceCm: 149, acrossCm: 100, alongCm: 110, upCm: 0 },
      }),
    );
    expect(screen.getByText(/149 cm from arena corner .* to corner of Box wall .*100 cm across \(x\), 110 cm along \(y\)\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(world.cleared).toBe(1);

    fireEvent.click(button);
    expect(world.measureModes.at(-1)).toBe(false);
    // ...and returns to the camera the student had before.
    expect(world.cameraModes.at(-1)).toBe('follow');
    expect(screen.queryByText(/149 cm/)).not.toBeInTheDocument();
  });

  it('moves the camera smoothly with the camera pad and arrow keys', async () => {
    render(<App />);
    await screen.findByTestId('maze-3d');
    await waitFor(() => expect(world.options).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Rotate camera left' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tilt camera up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Re-centre camera' }));
    const stage = screen.getByLabelText(/Arrow keys rotate/);
    fireEvent.keyDown(stage, { key: 'ArrowRight' });
    fireEvent.keyDown(stage, { key: '-' });
    expect(world.nudges).toEqual(['rotate-left', 'tilt-up', 'zoom-in', 'recenter', 'rotate-right', 'zoom-out']);
  });

  it('Reset cancels a take-off that is still getting ready', async () => {
    render(<App />);
    await screen.findByTestId('maze-3d');
    await userEvent.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, new File([fixture], 'main.xml'));
    await screen.findByText(/Program imported/);
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] });
    fireEvent.click(screen.getByRole('button', { name: /Run simulation/ }));
    fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(world.snapshots.at(-1)!.phase).toBe('idle');
    expect(screen.getByRole('button', { name: /Run simulation/ })).toBeEnabled();
  });
});
