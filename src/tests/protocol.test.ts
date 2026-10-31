import { describe, expect, it } from 'vitest';
import {
  CommandType,
  ControlFlightMode,
  HeadlessMode,
  PacketDecoder,
  commandPacket,
  controlPacket,
  controlPositionPacket,
  lostConnectionPacket,
  crc16,
  landingPacket,
  parseMotionYaw,
  parsePosition,
  parseState,
  requestMotionPacket,
  requestPositionPacket,
  requestStatePacket,
  stopPacket,
  takeOffPacket,
  toHex,
} from '../hardware/protocol';

// Golden bytes, computed independently with Python's binascii.crc_hqx (CRC-16/XMODEM)
// using the packet layout from Robolink's codrone-edu library.
const GOLDEN = {
  takeoff: '0a 55 11 02 70 10 07 11 36 81',
  land: '0a 55 11 02 70 10 07 12 55 b1',
  stop: '0a 55 11 02 70 10 01 00 80 29',
  requestState: '0a 55 04 01 70 10 40 0d 6c',
  control0: '0a 55 10 04 70 10 00 00 00 00 b4 bd',
  requestMotion: '0a 55 04 01 70 10 44 89 2c',
  requestPosition: '0a 55 04 01 70 10 42 4f 4c',
  /** Lost link: neutral 600 ms, land 3000 ms, stop 120 s; the drone read this back after it was set. */
  lostLink: '0a 55 54 08 70 10 58 02 b8 0b c0 d4 01 00 b8 5f',
  speed2: '0a 55 11 02 70 10 04 02 37 f6',
  modePosition: '0a 55 11 02 70 10 02 11 c3 7e',
  headlessNormal: '0a 55 11 02 70 10 03 02 a0 6f',
  /** Forward 0.5 m at 0.5 m/s. */
  moveForward50: '0a 55 10 14 70 10 00 00 00 3f 00 00 00 00 00 00 00 00 00 00 00 3f 00 00 00 00 fe c6',
  /** Right 0.3 m (y = -0.3) at 0.5 m/s. */
  moveRight30: '0a 55 10 14 70 10 00 00 00 00 9a 99 99 be 00 00 00 00 00 00 00 3f 00 00 00 00 3b f3',
  /** Drone → base motion, yaw -90°. */
  motionYawMinus90: '0a 55 44 12 10 70 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 a6 ff f3 14',
  /** Drone → base: Running, Ready, Position control, movement Ready, …, battery 87 %. */
  state: '0a 55 40 08 10 70 12 10 11 01 02 02 01 57 b4 aa',
};

const bytes = (hex: string) => Uint8Array.from(hex.split(' '), (h) => parseInt(h, 16));

describe('crc16', () => {
  it('matches the CRC-16/XMODEM check value', () => {
    expect(crc16(new TextEncoder().encode('123456789'))).toBe(0x31c3);
  });
});

describe('packet encoding', () => {
  it.each([
    ['takeoff', takeOffPacket()],
    ['land', landingPacket()],
    ['stop', stopPacket()],
    ['requestState', requestStatePacket()],
    ['control0', controlPacket(0, 0, 0, 0)],
    ['requestMotion', requestMotionPacket()],
    ['requestPosition', requestPositionPacket()],
    ['speed2', commandPacket(CommandType.ControlSpeed, 2)],
    ['modePosition', commandPacket(CommandType.ModeControlFlight, ControlFlightMode.Position)],
    ['headlessNormal', commandPacket(CommandType.Headless, HeadlessMode.Normal)],
    ['moveForward50', controlPositionPacket(0.5, 0, 0, 0.5)],
    ['moveRight30', controlPositionPacket(0, -0.3, 0, 0.5)],
    ['lostLink', lostConnectionPacket(600, 3000, 120_000)],
  ] as const)('%s matches the golden bytes', (name, packet) => {
    expect(toHex(packet)).toBe(GOLDEN[name]);
  });

  it('clamps and two’s-complements control values', () => {
    expect(Array.from(controlPacket(-150, 200, -1, 0).slice(6, 10))).toEqual([0x9c, 0x64, 0xff, 0x00]);
  });
});

describe('PacketDecoder', () => {
  it('decodes a state packet', () => {
    const [packet] = new PacketDecoder().push(bytes(GOLDEN.state));
    expect(packet).toMatchObject({ dataType: 0x40, from: 0x10, to: 0x70 });
    expect(parseState(packet!.payload)).toEqual({ system: 'Running', flight: 'Ready', movement: 'Ready', battery: 87 });
  });

  it('decodes a position reply captured from a real drone', () => {
    const payload = bytes('7d 12 8d 3c 1b 77 e1 3d b0 fc 04 3e');
    const p = parsePosition(payload)!;
    expect([p.x, p.y, p.z].map((v) => +v.toFixed(4))).toEqual([0.0172, 0.1101, 0.1299]);
  });

  it('decodes the yaw angle from a motion packet', () => {
    const [packet] = new PacketDecoder().push(bytes(GOLDEN.motionYawMinus90));
    expect(parseMotionYaw(packet!.payload)).toBe(-90);
  });

  it('reassembles packets split across chunks, including the start marker', () => {
    const d = new PacketDecoder();
    const all = bytes(`${GOLDEN.state} ${GOLDEN.takeoff}`);
    const packets = [];
    for (const b of all) packets.push(...d.push([b]));
    expect(packets.map((p) => p.dataType)).toEqual([0x40, 0x11]);
  });

  it('skips garbage and bad CRCs, then resyncs', () => {
    const d = new PacketDecoder();
    const corrupt = bytes(GOLDEN.state);
    corrupt[10] = corrupt[10]! ^ 0xff;
    const packets = d.push([0x00, 0x0a, 0x13, ...corrupt, ...bytes(GOLDEN.land)]);
    expect(packets.map((p) => p.dataType)).toEqual([0x11]);
    expect(d.rejected).toBe(1);
  });
});
