import { describe, expect, it } from 'vitest';
import { headingVector, moveTarget, normalizeHeading, turnHeading } from '../engine/MovementEngine';

describe('headingVector', () => {
  it.each([
    [0, { x: 0, y: -1 }],
    [90, { x: 1, y: 0 }],
    [180, { x: 0, y: 1 }],
    [270, { x: -1, y: 0 }],
  ])('heading %i° points the right way', (heading, expected) => {
    expect(headingVector(heading)).toEqual(expected);
  });
});

describe('moveTarget', () => {
  const origin = { x: 100, y: 100 };

  it.each([
    [0, { x: 100, y: 50 }],
    [90, { x: 150, y: 100 }],
    [180, { x: 100, y: 150 }],
    [270, { x: 50, y: 100 }],
  ])('forward 50 cm at heading %i°', (heading, expected) => {
    expect(moveTarget(origin, heading, 'FORWARD', 50)).toEqual(expected);
  });

  it('moves relative to heading for every direction (heading 0°)', () => {
    expect(moveTarget(origin, 0, 'BACKWARD', 20)).toEqual({ x: 100, y: 120 });
    expect(moveTarget(origin, 0, 'LEFT', 20)).toEqual({ x: 80, y: 100 });
    expect(moveTarget(origin, 0, 'RIGHT', 20)).toEqual({ x: 120, y: 100 });
  });

  it('strafes relative to heading when facing right (90°)', () => {
    expect(moveTarget(origin, 90, 'LEFT', 20)).toEqual({ x: 100, y: 80 });
    expect(moveTarget(origin, 90, 'RIGHT', 20)).toEqual({ x: 100, y: 120 });
    expect(moveTarget(origin, 90, 'BACKWARD', 20)).toEqual({ x: 80, y: 100 });
  });

  it('handles diagonal headings', () => {
    const p = moveTarget({ x: 0, y: 100 }, 45, 'FORWARD', Math.SQRT2 * 10);
    expect(p).toEqual({ x: 10, y: 90 });
  });

  it('a zero-length move stays in place', () => {
    expect(moveTarget(origin, 123, 'FORWARD', 0)).toEqual(origin);
  });
});

describe('turning', () => {
  it('turns right clockwise and left anticlockwise', () => {
    expect(turnHeading(0, 'RIGHT', 90)).toBe(90);
    expect(turnHeading(0, 'LEFT', 90)).toBe(270);
    expect(turnHeading(270, 'RIGHT', 180)).toBe(90);
  });

  it('wraps full turns back to 0', () => {
    expect(turnHeading(0, 'RIGHT', 360)).toBe(0);
    expect(turnHeading(90, 'LEFT', 450 - 90)).toBe(90);
  });

  it('normalizes headings into [0, 360)', () => {
    expect(normalizeHeading(-90)).toBe(270);
    expect(normalizeHeading(720)).toBe(0);
    expect(normalizeHeading(-0)).toBe(0);
  });
});
