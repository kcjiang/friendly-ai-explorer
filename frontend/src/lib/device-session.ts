import { useSyncExternalStore } from "react";
import {
  AdbDevice,
  checkWebSerialSupport,
  checkWebUsbSupport,
} from "./adb-webusb";

export type ConnectionKind = "adb" | "serial" | "remote";
export type SerialSettings = {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: "none" | "even" | "odd";
  flowControl: "none" | "hardware";
};
export const defaultSerial: SerialSettings = {
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
  flowControl: "none",
};

export class DeviceSession {
  private listeners = new Set<() => void>();
  private receivers = new Set<(data: string) => void>();
  private state = { status: "disconnected", error: "", revision: 0 };
  private port?: SerialPort;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private queue: Promise<void> = Promise.resolve();
  private shell?: Awaited<ReturnType<AdbDevice["interactive"]>>;
  adb?: AdbDevice;
  transcript = "";
  hex = false;
  private decoder = new TextDecoder();
  private closing = false;
  private disconnectTask?: Promise<void>;
  serialSettings = { ...defaultSerial };
  constructor(readonly kind: ConnectionKind) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  receive(listener: (data: string) => void) {
    this.receivers.add(listener);
    return () => {
      this.receivers.delete(listener);
    };
  }
  private update(status: string, error = "") {
    this.state = { status, error, revision: this.state.revision + 1 };
    this.listeners.forEach((listener) => listener());
  }
  output(data: string) {
    this.transcript = (this.transcript + data).slice(-500000);
    this.receivers.forEach((listener) => listener(data));
  }
  clear() {
    this.transcript = "";
    this.receivers.forEach((listener) => listener("\x1b[2J\x1b[H"));
  }
  private bytes = (data: Uint8Array) =>
    this.output(
      this.hex
        ? Array.from(data, (b) => b.toString(16).padStart(2, "0")).join(" ") +
            "\r\n"
        : this.decoder.decode(data, { stream: true }),
    );
  async connect(settings = defaultSerial) {
    if (this.state.status !== "disconnected" && this.state.status !== "error")
      return;
    if (this.adb || this.port) await this.disconnect();
    this.closing = false;
    this.serialSettings = { ...settings };
    this.update("connecting");
    try {
      const unsupported =
        this.kind === "adb" ? checkWebUsbSupport() : checkWebSerialSupport();
      if (unsupported) throw new Error(unsupported);
      if (this.kind === "adb") {
        this.adb = await AdbDevice.request();
        await this.adb.connect((status, error) => this.update(status, error));
        this.shell = await this.adb.interactive(this.bytes, () => {
          if (!this.closing) this.update("error", "Shell closed");
        });
      } else {
        this.port = await navigator.serial.requestPort();
        await this.port.open(settings);
        this.writer = this.port.writable!.getWriter();
        this.reader = this.port.readable!.getReader();
        void this.readSerial();
      }
      this.update("connected");
    } catch (error) {
      await this.disconnect();
      this.update("error", String(error));
    }
  }
  private async readSerial() {
    try {
      while (this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) this.bytes(value);
      }
      if (!this.closing) throw new Error("Serial disconnected");
    } catch (error) {
      if (!this.closing) {
        await this.disconnect();
        this.update("error", String(error));
      }
    }
  }
  write(data: string | Uint8Array, onTransmit?: () => void) {
    const bytes =
      typeof data === "string" ? new TextEncoder().encode(data) : data;
    const work = this.queue.then(async () => {
      if (this.state.status !== "connected")
        throw new Error("Device disconnected");
      onTransmit?.();
      if (this.kind === "adb") await this.shell!.write(bytes);
      else await this.writer!.write(bytes);
    });
    this.queue = work.catch(() => {});
    return work;
  }
  disconnect(): Promise<void> {
    if (this.disconnectTask) return this.disconnectTask;
    this.disconnectTask = this.finishDisconnect().finally(() => {
      this.disconnectTask = undefined;
    });
    return this.disconnectTask;
  }
  private async finishDisconnect() {
    this.closing = true;
    this.update("disconnecting");
    await this.adb?.disconnect();
    try {
      await this.reader?.cancel();
    } catch {
      /* unplugged */
    }
    try {
      this.reader?.releaseLock();
    } catch {
      /* unplugged */
    }
    this.reader = undefined;
    try {
      await this.writer?.abort();
    } catch {
      /* unplugged */
    }
    try {
      await this.queue;
      this.writer?.releaseLock();
      await this.port?.close();
    } catch {
      /* unplugged */
    }
    this.writer = undefined;
    this.port = undefined;
    this.adb = undefined;
    this.shell = undefined;
    this.decoder = new TextDecoder();
    this.update("disconnected");
  }
  async uploadScript(file: File) {
    if (!this.adb || this.state.status !== "connected")
      throw new Error("USB ADB required");
    if (!file.name.toLowerCase().endsWith(".sh") || file.size > 1024 * 1024)
      throw new Error("Select a .sh file up to 1 MiB");
    const contents = new TextEncoder().encode(
      (await file.text()).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"),
    );
    const path = `/data/local/tmp/fae-${crypto.randomUUID()}.sh`;
    const adb = this.adb;
    const exec = async (command: string) => {
      let result = "";
      await adb.shell(`${command} && echo FAE_UPLOAD_OK`, (data) => {
        result += data;
      });
      if (!result.includes("FAE_UPLOAD_OK"))
        throw new Error(result || "Script upload failed");
    };
    try {
      await exec(`umask 077; : > '${path}'`);
      for (let i = 0; i < contents.length; i += 512) {
        const escaped = Array.from(
          contents.slice(i, i + 512),
          (byte) => `\\${byte.toString(8).padStart(3, "0")}`,
        ).join("");
        await exec(`printf '${escaped}' >> '${path}'`);
      }
      await this.write(`sh '${path}'; rm -f '${path}'\r`);
    } catch (error) {
      if (adb.isConnected)
        await adb.shell(`rm -f '${path}'`, () => {}).catch(() => {});
      throw error;
    }
  }
}

export const deviceSessions = {
  adb: new DeviceSession("adb"),
  serial: new DeviceSession("serial"),
  remote: new DeviceSession("remote"),
};
export function useDeviceSession(kind: ConnectionKind) {
  const session = deviceSessions[kind];
  const state = useSyncExternalStore(
    session.subscribe,
    session.snapshot,
    session.snapshot,
  );
  return { session, ...state };
}
