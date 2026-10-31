import { CHALLENGES } from './challenges';
import { LESSONS, lessonFirstFlight } from './lessons';
import { openField } from './open-field';
import type { MazeDefinition } from './types';

/** The course picker's groups, in order. Add new courses to a group; they appear automatically. */
export const COURSE_GROUPS: ReadonlyArray<{ readonly label: string; readonly courses: readonly MazeDefinition[] }> = [
  { label: 'Flight School', courses: LESSONS },
  { label: 'Maze challenges', courses: CHALLENGES },
  { label: 'Free flight', courses: [openField] },
];

export const MAZES: readonly MazeDefinition[] = COURSE_GROUPS.flatMap((g) => g.courses);

export const DEFAULT_MAZE = lessonFirstFlight;

export function findMaze(id: string): MazeDefinition | undefined {
  return MAZES.find((maze) => maze.id === id);
}
