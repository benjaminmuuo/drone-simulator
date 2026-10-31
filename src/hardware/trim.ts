import type { Trim } from './protocol';

/**
 * One round of drift correction: from how fast the drone drifted while hovering (relative to
 * itself), the next roll/pitch trim. Small, capped steps, because nothing documents how many
 * trim units correct how much drift; repeat rounds until it holds still.
 *
 * Signs follow codrone-edu: roll + leans right, pitch + leans forward. A drone drifting right
 * needs less roll, one drifting forward needs less pitch.
 */
export const TRIM_RULES = {
  /** Below this drift (cm/s) the drone counts as holding still. */
  deadbandCmPerS: 0.5,
  /** Trim units per cm/s of drift. */
  gain: 1,
  /** Largest change in one round. */
  maxStep: 4,
  /** Never trim further than this from zero. */
  limit: 30,
} as const;

export interface TrimRound {
  readonly trim: Trim;
  readonly rollStep: number;
  readonly pitchStep: number;
  /** True when the drift is within the deadband both ways: nothing to change. */
  readonly holdingStill: boolean;
}

const step = (rate: number) => {
  if (Math.abs(rate) < TRIM_RULES.deadbandCmPerS) return 0;
  const s = Math.round(rate * TRIM_RULES.gain);
  // At least one unit once the drift is above the deadband.
  return Math.max(-TRIM_RULES.maxStep, Math.min(TRIM_RULES.maxStep, s === 0 ? Math.sign(rate) : s));
};

const clamp = (v: number) => Math.max(-TRIM_RULES.limit, Math.min(TRIM_RULES.limit, v));

export function nextTrim(current: Trim, drift: { readonly forwardCmPerS: number; readonly rightCmPerS: number }): TrimRound {
  const rollStep = step(drift.rightCmPerS);
  const pitchStep = step(drift.forwardCmPerS);
  return {
    trim: { ...current, roll: clamp(current.roll - rollStep), pitch: clamp(current.pitch - pitchStep) },
    rollStep,
    pitchStep,
    holdingStill: rollStep === 0 && pitchStep === 0,
  };
}
