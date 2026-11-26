import { describe, expect, it } from 'vitest';
import { FLOOR_CALIBRATION, realCm, toRealFlight } from '../hardware/floorCalibration';
import type { DroneCommand } from '../parser/types';

const takeoff: DroneCommand = { type: 'TAKEOFF', blockId: 't' };
const land: DroneCommand = { type: 'LAND', blockId: 'l' };
const hover = (durationSeconds: number): DroneCommand => ({ type: 'HOVER', durationSeconds, blockId: 'h' });
const forward = (distanceCm: number): DroneCommand => ({ type: 'MOVE', direction: 'FORWARD', distanceCm, blockId: 'm' });
const right: DroneCommand = { type: 'TURN', direction: 'RIGHT', degrees: 90, blockId: 'r' };

const shape = (commands: readonly DroneCommand[]) =>
  commands.map((c) => (c.type === 'HOVER' ? `H${c.durationSeconds}` : c.type === 'MOVE' ? `M${c.distanceCm}` : c.type));

describe('floor calibration', () => {
  it('sends up and down moves as written (the floor calibration measured sideways moves only)', () => {
    const up: DroneCommand = { type: 'VERTICAL', direction: 'UP', distanceCm: 30, blockId: 'u' };
    const plan = toRealFlight([takeoff, up, land]);
    expect(plan.commands).toContainEqual(up);
  });

  it('translates floor distances into what the drone is sent', () => {
    expect([160, 240].map(realCm)).toEqual([107, 161]);
    expect(realCm(0)).toBe(0);
    expect(realCm(1)).toBe(1);
  });

  it('adds settling hovers and maps every step back to the student block', () => {
    const plan = toRealFlight([takeoff, forward(160), right, forward(240), land]);
    expect(shape(plan.commands)).toEqual(['TAKEOFF', 'H3', 'M107', 'H1.5', 'TURN', 'M161', 'LAND']);
    expect(plan.sourceIndex).toEqual([0, 0, 1, 2, 2, 3, 4]);
    expect(plan.commands[3]?.blockId).toBe('r');
  });

  it("counts the student's own hovers instead of adding more", () => {
    const plan = toRealFlight([takeoff, hover(2), forward(60), hover(FLOOR_CALIBRATION.turnHoverSeconds), right, land]);
    expect(shape(plan.commands)).toEqual(['TAKEOFF', 'H3', 'M40', 'H1.5', 'TURN', 'LAND']);
    expect(shape(toRealFlight([takeoff, hover(5), land]).commands)).toEqual(['TAKEOFF', 'H5', 'LAND']);
  });

  it('leaves the original program untouched', () => {
    const program = [takeoff, forward(160), land];
    toRealFlight(program);
    expect(program[1]).toEqual(forward(160));
  });
});
