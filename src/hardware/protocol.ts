/**
 * CoDrone EDU serial protocol (the subset this app needs).
 *
 * Byte layout and values follow Robolink's `codrone-edu` Python library
 * (protocol.py, system.py, receiver.py):
 *
 *   0x0A 0x55 | dataType length from to | payload[length] | crc16 (LE)
 *
 * The CRC is CRC-16/XMODEM (poly 0x1021, init 0) over header + payload.
 * Everything here is pure: no I/O, no timers.
 */

export const START_BYTES = [0x0a, 0x55] as const;
export const MAX_PAYLOAD = 128;

export const DataType = {
  Ping: 0x01,
  Ack: 0x02,
  Error: 0x03,
  Request: 0x04,
  Control: 0x10,
  Command: 0x11,
  State: 0x40,
  Position: 0x42,
  Motion: 0x44,
} as const;

export const DeviceType = {
  Drone: 0x10,
  Controller: 0x20,
  Base: 0x70,
} as const;

export const CommandType = {
  Stop: 0x01,
  ModeControlFlight: 0x02,
  Headless: 0x03,
  ControlSpeed: 0x04,
  FlightEvent: 0x07,
} as const;

/** Option values for CommandType.ModeControlFlight / Headless. */
export const ControlFlightMode = { Position: 0x11 } as const;
export const HeadlessMode = { Normal: 0x02 } as const;

export const ModeMovement = {
  0x00: 'None',
  0x01: 'Ready',
  0x02: 'Hovering',
  0x03: 'Moving',
  0x04: 'ReturnHome',
} as const satisfies Record<number, string>;

export const FlightEvent = {
  TakeOff: 0x11,
  Landing: 0x12,
} as const;

export const ModeFlight = {
  0x00: 'None',
  0x10: 'Ready',
  0x11: 'Start',
  0x12: 'TakeOff',
  0x13: 'Flight',
  0x14: 'Landing',
  0x15: 'Flip',
  0x16: 'Reverse',
  0x20: 'Stop',
  0x30: 'Accident',
  0x31: 'Error',
  0x40: 'Test',
} as const satisfies Record<number, string>;

export const ModeSystem = {
  0x00: 'None',
  0x10: 'Boot',
  0x11: 'Start',
  0x12: 'Running',
  0x13: 'ReadyToReset',
  0xa0: 'Error',
} as const satisfies Record<number, string>;

export type FlightMode = (typeof ModeFlight)[keyof typeof ModeFlight] | 'Unknown';
export type SystemMode = (typeof ModeSystem)[keyof typeof ModeSystem] | 'Unknown';
export type MovementMode = (typeof ModeMovement)[keyof typeof ModeMovement] | 'Unknown';

export interface Packet {
  readonly dataType: number;
  readonly from: number;
  readonly to: number;
  readonly payload: Uint8Array;
}

export interface DroneStatus {
  readonly system: SystemMode;
  readonly flight: FlightMode;
  readonly movement: MovementMode;
  /** 0–100 %. */
  readonly battery: number;
}

/* ---------- CRC ---------- */

export function crc16(bytes: ArrayLike<number>, crc = 0): number {
  let c = crc;
  for (let i = 0; i < bytes.length; i++) {
    c ^= (bytes[i] ?? 0) << 8;
    for (let b = 0; b < 8; b++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c;
}

/* ---------- Encoding ---------- */

export function encodePacket(dataType: number, payload: ArrayLike<number>, to: number = DeviceType.Drone): Uint8Array {
  if (payload.length > MAX_PAYLOAD) throw new RangeError(`Payload too long (${payload.length} bytes)`);
  const body = new Uint8Array(4 + payload.length);
  body.set([dataType, payload.length, DeviceType.Base, to]);
  body.set(Array.from(payload), 4);
  const crc = crc16(body);
  const out = new Uint8Array(2 + body.length + 2);
  out.set(START_BYTES);
  out.set(body, 2);
  out[out.length - 2] = crc & 0xff;
  out[out.length - 1] = crc >> 8;
  return out;
}

export const takeOffPacket = () => encodePacket(DataType.Command, [CommandType.FlightEvent, FlightEvent.TakeOff]);
export const landingPacket = () => encodePacket(DataType.Command, [CommandType.FlightEvent, FlightEvent.Landing]);
/** Emergency stop: cuts the motors immediately. */
export const stopPacket = () => encodePacket(DataType.Command, [CommandType.Stop, 0]);
export const requestStatePacket = () => encodePacket(DataType.Request, [DataType.State]);
export const requestMotionPacket = () => encodePacket(DataType.Request, [DataType.Motion]);
export const requestPositionPacket = () => encodePacket(DataType.Request, [DataType.Position]);
export const commandPacket = (commandType: number, option: number) =>
  encodePacket(DataType.Command, [commandType, option]);

const int8 = (v: number) => Math.max(-100, Math.min(100, Math.round(v))) & 0xff;
/** Roll, pitch, yaw, throttle, each -100..100 (yaw + = turn left). All zero = hold position. */
export const controlPacket = (roll: number, pitch: number, yaw: number, throttle: number) =>
  encodePacket(DataType.Control, [int8(roll), int8(pitch), int8(yaw), int8(throttle)]);

/**
 * Relative position move, as codrone-edu's sendControlPosition.
 * x: forward +, y: left +, z: up + (metres, ±10); velocity 0.5–2 m/s;
 * heading: turn left + (degrees); rotationalVelocity: degrees/s.
 */
export function controlPositionPacket(x: number, y: number, z: number, velocity: number, heading = 0, rotationalVelocity = 0) {
  const view = new DataView(new ArrayBuffer(20));
  view.setFloat32(0, x, true);
  view.setFloat32(4, y, true);
  view.setFloat32(8, z, true);
  view.setFloat32(12, velocity, true);
  view.setInt16(16, heading, true);
  view.setInt16(18, rotationalVelocity, true);
  return encodePacket(DataType.Control, new Uint8Array(view.buffer));
}

/* ---------- Decoding ---------- */

export function parseState(payload: Uint8Array): DroneStatus | null {
  if (payload.length !== 8) return null;
  // Byte order: modeSystem, modeFlight, modeControlFlight, modeMovement, headless, controlSpeed, sensorOrientation, battery.
  return {
    system: (ModeSystem as Record<number, SystemMode>)[payload[0] as number] ?? 'Unknown',
    flight: (ModeFlight as Record<number, FlightMode>)[payload[1] as number] ?? 'Unknown',
    movement: (ModeMovement as Record<number, MovementMode>)[payload[3] as number] ?? 'Unknown',
    battery: payload[7] as number,
  };
}

/** Position from a Position packet, in metres (x forward, y left, from the take-off point). */
export function parsePosition(payload: Uint8Array): { x: number; y: number; z: number } | null {
  if (payload.length !== 12) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return { x: view.getFloat32(0, true), y: view.getFloat32(4, true), z: view.getFloat32(8, true) };
}

/** Yaw angle from a Motion packet, in degrees (-180..180, left +). */
export function parseMotionYaw(payload: Uint8Array): number | null {
  if (payload.length !== 18) return null;
  return new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getInt16(16, true);
}

/**
 * Incremental packet decoder. Feed it whatever chunks the serial port
 * delivers; complete, CRC-valid packets come out. Garbage is skipped by
 * resynchronising on the next 0x0A 0x55.
 */
export class PacketDecoder {
  private buf: number[] = [];
  /** Packets dropped because of a bad CRC or impossible length. */
  rejected = 0;

  push(chunk: ArrayLike<number>): Packet[] {
    for (let i = 0; i < chunk.length; i++) this.buf.push(chunk[i] as number);
    const out: Packet[] = [];

    for (;;) {
      const start = this.findStart();
      if (start < 0) {
        // Keep a trailing 0x0A: it may be the first half of a start marker.
        this.buf = this.buf.at(-1) === START_BYTES[0] ? [START_BYTES[0]] : [];
        break;
      }
      if (start > 0) this.buf.splice(0, start);
      if (this.buf.length < 6) break;

      const length = this.buf[3] as number;
      if (length > MAX_PAYLOAD) {
        this.rejected++;
        this.buf.splice(0, 2);
        continue;
      }
      const total = 2 + 4 + length + 2;
      if (this.buf.length < total) break;

      const body = this.buf.slice(2, 6 + length);
      const received = (this.buf[6 + length] as number) | ((this.buf[7 + length] as number) << 8);
      if (crc16(body) !== received) {
        this.rejected++;
        this.buf.splice(0, 2);
        continue;
      }
      out.push({
        dataType: body[0] as number,
        from: body[2] as number,
        to: body[3] as number,
        payload: Uint8Array.from(body.slice(4)),
      });
      this.buf.splice(0, total);
    }
    return out;
  }

  private findStart(): number {
    for (let i = 0; i + 1 < this.buf.length; i++) {
      if (this.buf[i] === START_BYTES[0] && this.buf[i + 1] === START_BYTES[1]) return i;
    }
    return -1;
  }
}

export const toHex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
