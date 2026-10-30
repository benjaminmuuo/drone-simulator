import { circleOverlapsRect, rectContainsPoint } from '../engine/CollisionDetector';
import type { MazeDefinition, Rect } from './types';

function rectInside(rect: Rect, maze: MazeDefinition): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.width <= maze.widthCm &&
    rect.y + rect.height <= maze.heightCm
  );
}

const isFiniteNumber = (n: number) => Number.isFinite(n);

/** Returns a list of problems; an empty list means the maze is usable. */
export function validateMaze(maze: MazeDefinition): string[] {
  const problems: string[] = [];
  const r = maze.droneRadiusCm;

  if (maze.id.trim() === '') problems.push('Maze id must not be empty.');
  if (!(maze.widthCm > 0 && maze.heightCm > 0)) problems.push('Arena width and height must be positive.');
  if (!(r > 0)) problems.push('Drone radius must be positive.');
  if (!(maze.gridSpacingCm > 0)) problems.push('Grid spacing must be positive.');
  if (!isFiniteNumber(maze.startHeadingDeg)) problems.push('Start heading must be a finite number.');

  const { x, y } = maze.start;
  if (!(x - r >= 0 && y - r >= 0 && x + r <= maze.widthCm && y + r <= maze.heightCm)) {
    problems.push('The drone does not fit inside the arena at the start position.');
  }

  const ids = new Set<string>();
  const checkId = (id: string) => {
    if (ids.has(id)) problems.push(`Duplicate id "${id}".`);
    ids.add(id);
  };

  for (const obstacle of maze.obstacles) {
    checkId(obstacle.id);
    if (!rectInside(obstacle, maze)) problems.push(`Obstacle "${obstacle.id}" is outside the arena or has no size.`);
    if (circleOverlapsRect(maze.start, r, obstacle)) problems.push(`The start position overlaps obstacle "${obstacle.id}".`);
    if (obstacle.heightCm !== undefined && !(obstacle.heightCm > 0)) {
      problems.push(`Obstacle "${obstacle.id}" needs a positive height.`);
    }
  }
  for (const zone of maze.noFlyZones) {
    checkId(zone.id);
    if (!rectInside(zone, maze)) problems.push(`No-fly zone "${zone.id}" is outside the arena or has no size.`);
    if (circleOverlapsRect(maze.start, r, zone)) problems.push(`The start position overlaps no-fly zone "${zone.id}".`);
  }

  if (!rectInside(maze.landingZone, maze)) problems.push('The landing zone is outside the arena or has no size.');
  for (const blocker of [...maze.obstacles, ...maze.noFlyZones]) {
    if (circleOverlapsRect(
      { x: maze.landingZone.x + maze.landingZone.width / 2, y: maze.landingZone.y + maze.landingZone.height / 2 },
      r,
      blocker,
    )) {
      problems.push(`The centre of the landing zone is blocked by "${blocker.id}".`);
    }
  }

  for (const cp of maze.checkpoints) {
    checkId(cp.id);
    if (!(cp.radiusCm > 0)) problems.push(`Checkpoint "${cp.id}" needs a positive radius.`);
    if (cp.x < 0 || cp.y < 0 || cp.x > maze.widthCm || cp.y > maze.heightCm) {
      problems.push(`Checkpoint "${cp.id}" is outside the arena.`);
    }
    for (const blocker of [...maze.obstacles, ...maze.noFlyZones]) {
      if (rectContainsPoint(blocker, cp)) problems.push(`Checkpoint "${cp.id}" is inside "${blocker.id}".`);
    }
  }

  return problems;
}
