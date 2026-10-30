import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { Timeline } from '../animation/timeline';
import type { SimulationFailure } from '../engine/types';
import type { PlaybackPhase } from '../hooks/useSimulation';
import type { MazeDefinition, Point } from '../mazes/types';
import { createDroneWorld } from '../three/createDroneWorld';
import type { CameraMode, CameraNudge, DroneWorld, FollowView, MeasureState, WorldSnapshot } from '../three/createDroneWorld';
import type { ThemeId } from '../three/themeOptions';

/** Imperative camera / measuring actions the app can trigger (camera pad, keys). */
export interface ViewportController {
  nudgeCamera(action: CameraNudge): void;
  clearMeasurement(): void;
}

export interface Maze3DViewportProps {
  readonly maze: MazeDefinition;
  readonly theme: ThemeId;
  readonly flightHeightCm: number;
  readonly timeline: Timeline;
  readonly elapsed: number;
  readonly phase: PlaybackPhase;
  readonly failure: SimulationFailure | null;
  readonly visitedCheckpoints: ReadonlySet<string>;
  readonly trail: readonly Point[];
  readonly showGrid: boolean;
  readonly cameraMode: CameraMode;
  readonly followView: FollowView;
  readonly measureMode: boolean;
  readonly onMeasure: (state: MeasureState) => void;
  /** Called if the 3D world cannot be created (e.g. WebGL blocked). */
  readonly onError: (message: string) => void;
  /** Filled in while the 3D world is running. */
  readonly controllerRef?: MutableRefObject<ViewportController | null>;
}

/** Default export so it can be code-split with React.lazy. */
export default function Maze3DViewport(props: Maze3DViewportProps) {
  const { maze, theme, flightHeightCm, timeline, elapsed, phase, failure, visitedCheckpoints, trail } = props;
  const { showGrid, cameraMode, followView, measureMode, onMeasure, onError, controllerRef } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<DroneWorld | null>(null);
  const snapshot: WorldSnapshot = { timeline, elapsed, phase, failure, visitedCheckpoints, trail };
  const latest = useRef({ snapshot, showGrid, cameraMode, followView, flightHeightCm, measureMode, onMeasure });
  latest.current = { snapshot, showGrid, cameraMode, followView, flightHeightCm, measureMode, onMeasure };

  // (Re)build the world when the maze or theme changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let world: DroneWorld;
    try {
      world = createDroneWorld(container, maze, { theme, onMeasure: (state) => latest.current.onMeasure(state) });
    } catch (error) {
      onError(error instanceof Error ? error.message : 'The 3D view could not start.');
      return undefined;
    }
    const current = latest.current;
    world.setShowGrid(current.showGrid);
    world.setFlightHeight(current.flightHeightCm);
    world.setFollowView(current.followView);
    world.setCameraMode(current.cameraMode);
    world.setMeasureMode(current.measureMode);
    world.setSnapshot(current.snapshot);
    worldRef.current = world;
    if (controllerRef) controllerRef.current = world;
    return () => {
      world.dispose();
      worldRef.current = null;
      if (controllerRef?.current === world) controllerRef.current = null;
    };
  }, [maze, theme, onError, controllerRef]);

  useEffect(() => {
    worldRef.current?.setSnapshot({ timeline, elapsed, phase, failure, visitedCheckpoints, trail });
  }, [timeline, elapsed, phase, failure, visitedCheckpoints, trail]);

  useEffect(() => {
    worldRef.current?.setCameraMode(cameraMode);
  }, [cameraMode]);

  useEffect(() => {
    worldRef.current?.setFollowView(followView);
  }, [followView]);

  useEffect(() => {
    worldRef.current?.setShowGrid(showGrid);
  }, [showGrid]);

  useEffect(() => {
    worldRef.current?.setFlightHeight(flightHeightCm);
  }, [flightHeightCm]);

  useEffect(() => {
    worldRef.current?.setMeasureMode(measureMode);
  }, [measureMode]);

  return (
    <div
      ref={containerRef}
      className="maze3d"
      role="img"
      aria-label={`3D view of ${maze.name}. Drag to rotate the camera, scroll to zoom.`}
      data-testid="maze-3d"
    />
  );
}
