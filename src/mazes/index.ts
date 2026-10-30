import { beginnerMaze } from './beginner-maze';
import { boxSlalom } from './box-slalom';
import { openField } from './open-field';
import type { MazeDefinition } from './types';

/** Add new challenges here; they appear in the maze picker automatically. */
export const MAZES: readonly MazeDefinition[] = [beginnerMaze, boxSlalom, openField];

export const DEFAULT_MAZE = beginnerMaze;

export function findMaze(id: string): MazeDefinition | undefined {
  return MAZES.find((maze) => maze.id === id);
}
