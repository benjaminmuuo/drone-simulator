import { PacketDecoder } from './protocol';
import type { Packet } from './protocol';

/** CoDrone EDU controller: STM32 virtual COM port (VID 1155 in codrone-edu). */
export const CONTROLLER_USB = { usbVendorId: 0x0483, usbProductId: 0x5740 } as const;
export const BAUD_RATE = 57600;

export const isWebSerialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator;

type PacketListener = (packet: Packet) => void;
type BytesListener = (direction: 'tx' | 'rx', bytes: Uint8Array) => void;

/** One open USB serial connection to the controller. */
export class SerialLink {
  private readonly decoder = new PacketDecoder();
  private readonly packetListeners = new Set<PacketListener>();
  private readonly bytesListeners = new Set<BytesListener>();
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private closed = false;
  private closing = false;
  readonly done: Promise<void>;

  private constructor(private readonly port: SerialPort) {
    this.writer = port.writable?.getWriter() ?? null;
    this.done = this.readLoop();
  }

  /** Shows the browser's port picker (must be called from a user gesture). */
  static async request(): Promise<SerialLink> {
    if (!navigator.serial) throw new Error('Web Serial is not available. Use Chrome or Edge on a computer.');
    const port = await navigator.serial.requestPort({ filters: [{ usbVendorId: CONTROLLER_USB.usbVendorId }] });
    await port.open({ baudRate: BAUD_RATE });
    return new SerialLink(port);
  }

  get rejectedPackets() {
    return this.decoder.rejected;
  }

  onPacket(listener: PacketListener): () => void {
    this.packetListeners.add(listener);
    return () => this.packetListeners.delete(listener);
  }

  onBytes(listener: BytesListener): () => void {
    this.bytesListeners.add(listener);
    return () => this.bytesListeners.delete(listener);
  }

  async send(bytes: Uint8Array): Promise<void> {
    if (!this.writer || this.closed) throw new Error('The controller is not connected.');
    this.bytesListeners.forEach((l) => l('tx', bytes));
    await this.writer.write(bytes);
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.closed = true;
    await this.reader?.cancel().catch(() => {});
    await this.done.catch(() => {});
    this.writer?.releaseLock();
    await this.port.close().catch(() => {});
  }

  private async readLoop(): Promise<void> {
    while (!this.closed && this.port.readable) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (!value) continue;
          this.bytesListeners.forEach((l) => l('rx', value));
          for (const packet of this.decoder.push(value)) this.packetListeners.forEach((l) => l(packet));
        }
      } catch {
        // Non-fatal errors (e.g. a framing error) leave port.readable set and we keep reading;
        // fatal ones (cable unplugged) clear it and end the loop.
      } finally {
        this.reader.releaseLock();
        this.reader = null;
      }
    }
    // Unplugged (or closed): nothing more can be sent.
    this.closed = true;
  }
}
