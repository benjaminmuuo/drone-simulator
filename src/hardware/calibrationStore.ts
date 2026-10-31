import { DEFAULT_CALIBRATION } from './DroneRunner';
import type { Calibration } from './DroneRunner';

/**
 * The learned calibration, kept in this browser so it survives reconnecting and
 * reloading. The app and the hardware test page share it (same origin). It is
 * per browser, not per drone: reset it when switching to a different drone.
 */
const STORAGE_KEY = 'birds.droneCalibration.v1';

const inRange = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export function loadCalibration(): Calibration {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Calibration> | null;
    if (saved && inRange(saved.overshootDeg, 0, 15) && inRange(saved.moveRatio, 0.5, 1.5)) {
      // Calibrations saved before after-turn moves were learned separately start from the one ratio.
      const afterTurn = inRange(saved.moveRatioAfterTurn, 0.5, 1.5) ? saved.moveRatioAfterTurn : saved.moveRatio;
      return { overshootDeg: saved.overshootDeg, moveRatio: saved.moveRatio, moveRatioAfterTurn: afterTurn };
    }
  } catch {
    // Blocked storage or a damaged value: start from the defaults.
  }
  return DEFAULT_CALIBRATION;
}

export function saveCalibration(calibration: Calibration): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(calibration));
  } catch {
    // Private mode or blocked storage: calibration just isn't remembered.
  }
}

export function clearCalibration(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
