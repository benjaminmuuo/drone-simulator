/**
 * Test double for the USB controller + drone, shared by the runner and hook tests.
 */
import type { DroneLink } from '../hardware/DroneRunner';
import { CommandType, DataType, FlightEvent, PacketDecoder, encodePacket } from '../hardware/protocol';
import type { Packet } from '../hardware/protocol';

export const FLIGHT = { Ready: 0x10, TakeOff: 0x12, Flight: 0x13, Landing: 0x14, Stop: 0x20 } as const;
const MOVEMENT = { Ready: 0x01, Hovering: 0x02, Moving: 0x03 } as const;

/**
 * A pretend drone + controller: answers requests and reacts to commands over (fake) time.
 *
 * Request handling copies what was measured on a real controller: it holds one
 * unanswered request, a newer request replaces it, and some replies are lost.
 */
export class FakeDrone implements DroneLink {
  flight: number = FLIGHT.Ready;
  movement: number = MOVEMENT.Ready;
  battery = 90;
  yaw = 0;
  /** Simulates a dead radio link / a broken heading sensor. */
  silent = false;
  answerMotion = true;
  readonly events: string[] = [];
  readonly moves: { x: number; y: number }[] = [];
  private yawPower = 0;
  /** Position in metres, in the take-off frame (x forward, y left). */
  x = 0;
  y = 0;
  /** Like the real drone, it keeps reporting "Moving" for a while after a turn. */
  settleMs = 800;
  /** Share of each requested move actually travelled (the real drone stops a little short). */
  travelRatio = 1;
  /** Extra rotation at the end of a turn, either method (as seen on hardware). */
  overshootDeg = 0;
  readonly turns: number[] = [];
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  /** The controller's single pending-request slot (newest request wins). */
  private pendingRequest: number | null = null;
  private replies = 0;
  /** Every Nth reply is lost (0 = none). */
  loseEvery = 6;
  private readonly decoder = new PacketDecoder();
  private listener: ((p: Packet) => void) | null = null;

  onPacket(listener: (p: Packet) => void) {
    this.listener = listener;
    return () => (this.listener = null);
  }

  async send(bytes: Uint8Array) {
    for (const p of this.decoder.push(bytes)) this.receive(p);
  }

  private reply(dataType: number, payload: number[]) {
    if (this.silent) return;
    if (this.loseEvery && ++this.replies % this.loseEvery === 0) return;
    const bytes = encodePacket(dataType, payload, 0x70);
    setTimeout(() => {
      for (const p of new PacketDecoder().push(bytes)) this.listener?.({ ...p, from: 0x10 });
    }, 5);
  }

  private later(ms: number, fn: () => void) {
    setTimeout(fn, ms);
  }

  private request(type: number) {
    const answer = this.pendingRequest === null;
    this.pendingRequest = type;
    if (!answer) return;
    this.later(30, () => {
      const t = this.pendingRequest;
      this.pendingRequest = null;
      if (t !== null) this.answer(t);
    });
  }

  private receive(p: Packet) {
    if (p.dataType === DataType.Request) this.request(p.payload[0] as number);
    else this.command(p);
  }

  private answer(type: number) {
    if (type === DataType.State) {
      this.reply(DataType.State, [0x12, this.flight, 0x11, this.movement, 0x02, 0x02, 0x01, this.battery]);
    } else if (type === DataType.Position) {
      const view = new DataView(new ArrayBuffer(12));
      view.setFloat32(0, this.x, true);
      view.setFloat32(4, this.y, true);
      this.reply(DataType.Position, Array.from(new Uint8Array(view.buffer)));
    } else if (type === DataType.Motion) {
      // Integrate the yaw command since the last request (≈ power × 1.5 °/s per unit).
      this.yaw = ((this.yaw + this.yawPower * 0.03 + 540) % 360) - 180;
      if (!this.answerMotion) return;
      const view = new DataView(new ArrayBuffer(18));
      view.setInt16(16, Math.round(this.yaw), true);
      this.reply(DataType.Motion, Array.from(new Uint8Array(view.buffer)));
    }
  }

  private command(p: Packet) {
    const d = p.payload;
    if (p.dataType === DataType.Command) {
      const [type, option] = [d[0], d[1]];
      if (type === CommandType.Stop) {
        this.events.push('STOP');
        this.flight = FLIGHT.Stop;
      } else if (type === CommandType.FlightEvent && option === FlightEvent.TakeOff && this.flight === FLIGHT.Ready) {
        this.events.push('TAKEOFF');
        this.flight = FLIGHT.TakeOff;
        this.later(2000, () => {
          this.flight = FLIGHT.Flight;
          this.movement = MOVEMENT.Hovering;
        });
      } else if (type === CommandType.FlightEvent && option === FlightEvent.Landing && this.flight === FLIGHT.Flight) {
        this.events.push('LAND');
        this.flight = FLIGHT.Landing;
        this.later(1200, () => {
          this.flight = FLIGHT.Ready;
          this.movement = MOVEMENT.Ready;
        });
      }
    } else if (p.dataType === DataType.Control && d.length === 20) {
      const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
      // A move sent while the drone is still moving (or steadying after a turn) is ignored.
      if (this.movement === MOVEMENT.Moving) return;
      const move = { x: view.getFloat32(0, true), y: view.getFloat32(4, true) };
      const v = view.getFloat32(12, true);
      const heading = view.getInt16(16, true);
      const rate = view.getInt16(18, true);
      if (heading !== 0) {
        // The drone turns itself (left +) at `rate` °/s.
        this.turns.push(heading);
        this.events.push(`TURN ${heading}`);
        this.movement = MOVEMENT.Moving;
        this.later((Math.abs(heading) / rate) * 1000, () => {
          this.yaw = ((this.yaw + heading + Math.sign(heading) * this.overshootDeg + 540) % 360) - 180;
          this.movement = MOVEMENT.Hovering;
        });
        return;
      }
      this.moves.push(move);
      this.events.push(`MOVE ${move.x.toFixed(2)},${move.y.toFixed(2)}`);
      this.movement = MOVEMENT.Moving;
      this.later((Math.hypot(move.x, move.y) / v) * 1000, () => {
        // The move is relative to the heading (yaw: left +).
        const r = (this.yaw * Math.PI) / 180;
        const k = this.travelRatio;
        this.x += k * (move.x * Math.cos(r) - move.y * Math.sin(r));
        this.y += k * (move.x * Math.sin(r) + move.y * Math.cos(r));
        this.movement = MOVEMENT.Hovering;
      });
    } else if (p.dataType === DataType.Control && d.length === 4) {
      const power = ((d[2] as number) << 24) >> 24;
      if (power !== 0) {
        clearTimeout(this.settleTimer);
        this.movement = MOVEMENT.Moving;
      } else if (this.yawPower !== 0) {
        this.yaw = ((this.yaw + Math.sign(this.yawPower) * this.overshootDeg + 540) % 360) - 180;
        this.settleTimer = setTimeout(() => (this.movement = MOVEMENT.Hovering), this.settleMs);
      }
      this.yawPower = power;
    }
  }
}
