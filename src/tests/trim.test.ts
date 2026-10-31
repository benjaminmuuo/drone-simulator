import { describe, expect, it } from 'vitest';
import { TRIM_RULES, nextTrim } from '../hardware/trim';

const zero = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };

describe('trim rounds', () => {
  it('leans against a drift: right drift → less roll, forward drift → less pitch', () => {
    const round = nextTrim(zero, { forwardCmPerS: 1.2, rightCmPerS: 2.2 });
    expect(round).toMatchObject({ rollStep: 2, pitchStep: 1, holdingStill: false });
    expect(round.trim).toMatchObject({ roll: -2, pitch: -1 });
  });

  it('counts a drift under the deadband as holding still', () => {
    const round = nextTrim({ ...zero, roll: -3 }, { forwardCmPerS: 0.3, rightCmPerS: -0.4 });
    expect(round.holdingStill).toBe(true);
    expect(round.trim).toEqual({ ...zero, roll: -3 });
  });

  it('takes at least one unit above the deadband, at most maxStep, and never passes the limit', () => {
    expect(nextTrim(zero, { forwardCmPerS: 0, rightCmPerS: 0.6 }).rollStep).toBe(1);
    expect(nextTrim(zero, { forwardCmPerS: 0, rightCmPerS: 50 }).rollStep).toBe(TRIM_RULES.maxStep);
    expect(nextTrim({ ...zero, roll: -29 }, { forwardCmPerS: 0, rightCmPerS: 50 }).trim.roll).toBe(-TRIM_RULES.limit);
  });

  it('keeps yaw and throttle trim as they are', () => {
    expect(nextTrim({ roll: 0, pitch: 0, yaw: 5, throttle: -2 }, { forwardCmPerS: 2, rightCmPerS: 2 }).trim).toMatchObject({ yaw: 5, throttle: -2 });
  });
});
