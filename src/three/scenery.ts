/**
 * What surrounds the arena for each theme, plus where the camera may go.
 */
import type { Object3D, Scene, WebGLRenderer } from 'three';
import type { MazeDefinition } from '../mazes/types';
import { createClassroom } from './classroom';
import { createForest } from './environment';
import type { ThemeId } from './themeOptions';

/** Horizontal box (world cm) the camera has to stay inside, and its ceiling. */
export interface CameraBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly maxY: number;
}

export interface Scenery {
  update(elapsedSeconds: number): void;
  dispose(): void;
  /** Where the follow camera may go (inside the net or the classroom). */
  readonly followBounds: CameraBounds;
  /** Where the overview camera may go; null = anywhere. */
  readonly orbitBounds: CameraBounds | null;
  /** Starting overview shot. */
  readonly overview: {
    readonly position: readonly [number, number, number];
    readonly target: readonly [number, number, number];
  };
  readonly fov: number;
  /** Tone-mapping exposure that suits the lighting. */
  readonly exposure: number;
  /** Ground the measuring tool can click on outside the arena. */
  readonly pickables: readonly Object3D[];
  /** Hide anything overhead (e.g. ceiling lights) so a top-down camera can look in from above. */
  setCutaway(on: boolean): void;
}

export type SceneryFactory = (scene: Scene, renderer: WebGLRenderer, maze: MazeDefinition) => Scenery;

export function createScenery(theme: ThemeId, scene: Scene, renderer: WebGLRenderer, maze: MazeDefinition): Scenery {
  return (theme === 'classroom' ? createClassroom : createForest)(scene, renderer, maze);
}
