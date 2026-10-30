/** All coordinates are centimetres. Origin top-left, +x right, +y down. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Axis-aligned rectangle; (x, y) is the top-left corner. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Obstacle extends Rect {
  readonly id: string;
  readonly label: string;
  /**
   * Real measured height. The drone flies over obstacles lower than its
   * flight height (minus a safety gap) and crashes into taller ones.
   */
  readonly heightCm?: number;
}

export interface NoFlyZone extends Rect {
  readonly id: string;
  readonly label: string;
}

export interface Checkpoint extends Point {
  readonly id: string;
  readonly label: string;
  /** The drone's centre must pass within this distance to collect it. */
  readonly radiusCm: number;
}

export interface MazeDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly widthCm: number;
  readonly heightCm: number;
  readonly start: Point;
  /** 0° = up, 90° = right, 180° = down, 270° = left. */
  readonly startHeadingDeg: number;
  readonly landingZone: Rect;
  readonly obstacles: readonly Obstacle[];
  readonly noFlyZones: readonly NoFlyZone[];
  /** All checkpoints must be visited for the mission to succeed. */
  readonly checkpoints: readonly Checkpoint[];
  readonly droneRadiusCm: number;
  /** Spacing of the optional background grid. */
  readonly gridSpacingCm: number;
}
