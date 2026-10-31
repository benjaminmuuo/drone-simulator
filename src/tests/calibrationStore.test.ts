import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CALIBRATION } from '../hardware/DroneRunner';
import { clearCalibration, loadCalibration, saveCalibration } from '../hardware/calibrationStore';

beforeEach(() => window.localStorage.clear());

describe('calibration store', () => {
  it('starts from the defaults', () => {
    expect(loadCalibration()).toEqual(DEFAULT_CALIBRATION);
  });

  it('remembers what the drone learned, and forgets it on reset', () => {
    saveCalibration({ overshootDeg: 5.5, moveRatio: 0.93 });
    expect(loadCalibration()).toEqual({ overshootDeg: 5.5, moveRatio: 0.93 });
    clearCalibration();
    expect(loadCalibration()).toEqual(DEFAULT_CALIBRATION);
  });

  it('ignores damaged or out-of-range values', () => {
    window.localStorage.setItem('birds.droneCalibration.v1', '{not json');
    expect(loadCalibration()).toEqual(DEFAULT_CALIBRATION);
    window.localStorage.setItem('birds.droneCalibration.v1', JSON.stringify({ overshootDeg: 99, moveRatio: 0.9 }));
    expect(loadCalibration()).toEqual(DEFAULT_CALIBRATION);
  });
});
