import { useSyncExternalStore } from "react";
import {
  AdbDevice,
  checkWebSerialSupport,
  checkWebUsbSupport,
} from "./adb-webusb";
import { encodeSerialText } from "./serial-text";
import { type PasteOptions, planPaste } from "./terminal-paste";
import type { RecordingOptions } from "./terminal-recording";

export type ConnectionKind = "adb" | "serial" | "remote";
export type SerialSettings = {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: "none" | "even" | "odd";
  flowControl: "none" | "hardware";
};
export const defaultSerial: SerialSettings = {
  baudRate: 921600,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
  flowControl: "none",
};

export class DeviceSession {
  private listeners = new Set<() => void>();
  private receivers = new Set<(data: string, reset?: boolean) => void>();
  private outputObservers = new Set<(data: string) => void>();
  private annotationObservers = new Set<(data: string) => void>();
  profileName = "";
  lineEnding = "\r\n";
  pasteDelayMs = 50;
  recordingOptions: RecordingOptions = {
    raw: false,
    timestamps: false,
    rotateMiB: 4,
  };
  private transportVersion = 0;
  private pasteController?: AbortController;
  private pasteWake?: () => void;
  private cols = 80;
  private rows = 24;
  private shellProtocol = "unavailable";
  private metrics = {
    started: 0,
    received: 0,
    transmitted: 0,
    readRecoveries: 0,
    reconnects: 0,
    handshakeRetries: 0,
  };
  private events: { at: string; status: string; detail: string }[] = [];
  private annotations: { at: string; text: string }[] = [];
  private ended = 0;
  sendEncoding: "utf-8" | "gbk" = "utf-8";
  private state = {
    status: "disconnected",
    error: "",
    warning: "",
    detail: "",
    revision: 0,
    pasting: false,
    pasteSent: 0,
    pasteTotal: 0,
  };
  private port?: SerialPort;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private queue: Promise<void> = Promise.resolve();
  private shell?: Awaited<ReturnType<AdbDevice["interactive"]>>;
  adb?: AdbDevice;
  transcript = "";
  hex = false;
  private decoder = new TextDecoder();
  receiveEncoding: "utf-8" | "gb18030" = "utf-8";
  private closing = false;
  private disconnectTask?: Promise<void>;
  private generation = 0;
  private wakeRecovery?: () => void;
  private serialReadTask?: Promise<void>;
  private serialCloseTask?: Promise<void>;
  serialSettings = { ...defaultSerial };
  constructor(readonly kind: ConnectionKind) {
    if (kind === "remote") this.serialSettings.baudRate = 9600;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  receive(listener: (data: string, reset?: boolean) => void) {
    this.receivers.add(listener);
    return () => {
      this.receivers.delete(listener);
    };
  }
  observeOutput(listener: (data: string) => void) {
    this.outputObservers.add(listener);
    return () => {
      this.outputObservers.delete(listener);
    };
  }
  setSendEncoding(encoding: "utf-8" | "gbk") {
    this.sendEncoding = encoding;
    this.update(this.state.status, this.state.error);
  }
  configure(options: {
    serialSettings?: SerialSettings;
    profileName?: string;
    lineEnding?: string;
    pasteDelayMs?: number;
    recordingOptions?: RecordingOptions;
  }) {
    if (
      options.serialSettings &&
      !["disconnected", "error"].includes(this.state.status)
    )
      throw new Error("Disconnect before changing serial parameters.");
    if (options.serialSettings)
      this.serialSettings = { ...options.serialSettings };
    if (options.profileName !== undefined)
      this.profileName = options.profileName;
    if (options.lineEnding !== undefined) this.lineEnding = options.lineEnding;
    if (options.pasteDelayMs !== undefined)
      this.pasteDelayMs = options.pasteDelayMs;
    if (options.recordingOptions)
      this.recordingOptions = { ...options.recordingOptions };
    this.update(this.state.status, this.state.error);
  }
  connectionToken = () => `${this.generation}:${this.transportVersion}`;
  getDiagnostics() {
    return {
      kind: this.kind,
      profile: this.profileName,
      status: this.state.status,
      ...this.metrics,
      elapsedSeconds: this.metrics.started
        ? Math.floor(((this.ended || Date.now()) - this.metrics.started) / 1000)
        : 0,
      cols: this.cols,
      rows: this.rows,
      protocol: this.kind === "adb" ? this.shellProtocol : "serial",
      serialSettings:
        this.kind === "adb" ? undefined : { ...this.serialSettings },
      receiveEncoding: this.receiveEncoding,
      sendEncoding: this.sendEncoding,
      annotations: this.annotations.length,
      events: [...this.events],
    };
  }
  getAnnotations = () => [...this.annotations];
  observeAnnotations(listener: (data: string) => void) {
    this.annotationObservers.add(listener);
    return () => {
      this.annotationObservers.delete(listener);
    };
  }
  addAnnotation(value: string) {
    const text = Array.from(value)
      .map((char) => {
        const code = char.charCodeAt(0);
        return code < 32 || (code >= 127 && code <= 159) ? " " : char;
      })
      .join("")
      .trim();
    if (!text || text.length > 200)
      throw new Error("A log note must contain 1–200 characters.");
    const at = new Date().toISOString();
    this.annotations = [...this.annotations, { at, text }].slice(-100);
    this.annotationObservers.forEach((fn) =>
      fn(`\r\n[FAE NOTE ${at}] ${text}\r\n`),
    );
    this.update(this.state.status, this.state.error);
  }
  async resize(cols: number, rows: number) {
    if (
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols < 2 ||
      cols > 1000 ||
      rows < 1 ||
      rows > 500
    )
      return;
    this.cols = cols;
    this.rows = rows;
    if (this.kind === "adb" && this.state.status === "connected")
      await this.shell?.resize(cols, rows);
  }
  private update(status: string, error = "") {
    if (status !== "connected") this.cancelPaste();
    if (
      ["disconnected", "error"].includes(status) &&
      this.metrics.started &&
      !this.ended
    )
      this.ended = Date.now();
    if (status !== this.state.status || error !== this.state.error) {
      this.events = [
        ...this.events,
        { at: new Date().toISOString(), status, detail: error.slice(0, 800) },
      ].slice(-100);
      if (status === "connected" && !this.metrics.started)
        this.metrics.started = Date.now();
    }
    this.state = {
      ...this.state,
      status,
      error,
      revision: this.state.revision + 1,
    };
    this.listeners.forEach((listener) => listener());
  }
  private warn(warning: string) {
    if (this.state.warning === warning) return;
    if (warning)
      this.events = [
        ...this.events,
        { at: new Date().toISOString(), status: "warning", detail: warning },
      ].slice(-100);
    this.state = { ...this.state, warning, revision: this.state.revision + 1 };
    this.listeners.forEach((listener) => listener());
  }
  setReceiveEncoding(encoding: "utf-8" | "gb18030") {
    this.receiveEncoding = encoding;
    this.decoder = new TextDecoder(encoding);
    this.state = { ...this.state, warning: "" };
    this.update(this.state.status, this.state.error);
  }
  output(data: string) {
    this.outputObservers.forEach((listener) => listener(data));
    this.transcript = (this.transcript + data).slice(-500000);
    this.receivers.forEach((listener) => listener(data));
  }
  clear() {
    this.transcript = "";
    this.receivers.forEach((listener) => listener("\x1b[2J\x1b[H", true));
  }
  private bytes = (data: Uint8Array) => {
    this.metrics.received += data.length;
    if (this.hex) {
      // HEX data must not leave an incomplete text character in the decoder.
      this.decoder = new TextDecoder(this.receiveEncoding);
      this.output(
        Array.from(data, (b) => b.toString(16).padStart(2, "0")).join(" ") +
          "\r\n",
      );
      return;
    }
    const text = this.decoder.decode(data, { stream: true });
    if (this.kind !== "adb") {
      if (text.includes("\uFFFD")) this.warn("decode");
      else if (text) this.warn("");
    }
    this.output(text);
  };
  async connect(settings = this.serialSettings) {
    if (this.state.status !== "disconnected" && this.state.status !== "error")
      return;
    if (this.adb || this.port) await this.disconnect();
    const generation = ++this.generation;
    this.metrics = {
      started: 0,
      received: 0,
      transmitted: 0,
      readRecoveries: 0,
      reconnects: 0,
      handshakeRetries: 0,
    };
    this.events = [];
    this.ended = 0;
    this.shellProtocol = "unavailable";
    this.closing = false;
    this.state = { ...this.state, detail: "" };
    this.warn("");
    this.serialSettings = { ...settings };
    this.update("connecting");
    try {
      const unsupported =
        this.kind === "adb" ? checkWebUsbSupport() : checkWebSerialSupport();
      if (unsupported) throw new Error(unsupported);
      if (this.kind === "adb") {
        const adb = await AdbDevice.request();
        if (generation !== this.generation) {
          await adb.disconnect();
          return;
        }
        this.adb = adb;
        await adb.connect((status, error) => {
          if (generation === this.generation) {
            if (
              status === "connecting" &&
              error?.startsWith("Retrying ADB handshake")
            ) {
              this.metrics.handshakeRetries++;
              this.events = [
                ...this.events,
                {
                  at: new Date().toISOString(),
                  status: "retry",
                  detail: error.slice(0, 800),
                },
              ].slice(-100);
            }
            this.state = {
              ...this.state,
              detail: status === "connected" ? "" : error || "",
            };
            // The transport is ready before its interactive shell is ready.
            this.update(
              status === "connected" ? "connecting" : status,
              status === "error" ? error : "",
            );
          }
        });
        if (generation !== this.generation) return;
        this.shell = await adb.interactive(this.bytes, () => {
          if (
            !this.closing &&
            generation === this.generation &&
            this.state.status !== "error"
          )
            this.update("error", "Shell closed");
        });
        this.shellProtocol = adb.interactiveProtocol;
        await this.shell.resize(this.cols, this.rows);
      } else {
        const port = await navigator.serial.requestPort();
        if (generation !== this.generation) {
          return;
        }
        this.port = port;
        await port.open({ ...settings, bufferSize: 64 * 1024 });
        if (generation !== this.generation) {
          await port.close();
          return;
        }
        this.writer = port.writable!.getWriter();
      }
      if (generation !== this.generation) return;
      this.update("connected");
      if (this.kind !== "adb") this.serialReadTask = this.readSerial();
    } catch (error) {
      if (generation !== this.generation) return;
      await this.disconnect();
      this.update("error", String(error));
    }
  }
  private async readSerial() {
    const port = this.port!;
    const generation = this.generation;
    const active = () => !this.closing && generation === this.generation;
    while (active()) {
      try {
        while (!this.closing && port.readable) {
          const reader = port.readable.getReader();
          this.reader = reader;
          let readError: unknown;
          try {
            while (!this.closing) {
              const { value, done } = await reader.read();
              if (done) break;
              if (value) this.bytes(value);
            }
          } catch (error) {
            readError = error;
          } finally {
            reader.releaseLock();
            if (this.reader === reader) this.reader = undefined;
          }
          if (!active()) return;
          const name = (readError as { name?: string } | undefined)?.name;
          if (
            port.readable &&
            [
              "BufferOverrunError",
              "BreakError",
              "FramingError",
              "ParityError",
            ].includes(name || "")
          ) {
            this.metrics.readRecoveries++;
            this.transportVersion++;
            this.cancelPaste();
            this.decoder = new TextDecoder(this.receiveEncoding);
            this.warn(name!);
            continue;
          }
          throw readError || new Error("Serial disconnected");
        }
        if (!this.closing) throw new Error("Serial disconnected");
      } catch {
        if (!active()) return;
        this.transportVersion++;
        this.cancelPaste();
        // Keep the selected port and transcript. Never request another device here.
        this.update("reconnecting");
        await this.closeSerial();
        let delay = 500;
        while (active()) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, delay);
            this.wakeRecovery = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          this.wakeRecovery = undefined;
          if (!active()) return;
          try {
            await port.open({ ...this.serialSettings, bufferSize: 64 * 1024 });
            if (!active()) {
              await port.close();
              return;
            }
            this.writer = port.writable!.getWriter();
            this.decoder = new TextDecoder(this.receiveEncoding);
            this.warn("");
            this.update("connected");
            this.metrics.reconnects++;
            break;
          } catch {
            // A detached or busy original port is retried with bounded frequency.
            await port.close().catch(() => {});
            delay = Math.min(delay * 2, 5000);
          }
        }
      }
    }
  }
  write(data: string | Uint8Array, onTransmit?: () => void) {
    if (data === "\x03") this.cancelPaste();
    else if (this.pasteController)
      return Promise.reject(
        new Error(
          "Paste is in progress; cancel it before typing another command.",
        ),
      );
    return this.enqueue(data, onTransmit);
  }
  private enqueue(data: string | Uint8Array, onTransmit?: () => void) {
    // Reject now as well as at execution: commands typed while offline must
    // never be delivered after the device recovers.
    if (this.state.status !== "connected")
      return Promise.reject(new Error("Device disconnected"));
    const generation = this.generation;
    const writer = this.writer;
    let bytes: Uint8Array;
    try {
      bytes =
        typeof data === "string"
          ? encodeSerialText(
              data,
              this.kind === "serial" ? this.sendEncoding : "utf-8",
            )
          : data;
    } catch (error) {
      return Promise.reject(error);
    }
    const work = this.queue.then(async () => {
      if (
        this.state.status !== "connected" ||
        generation !== this.generation ||
        writer !== this.writer
      )
        throw new Error("Device disconnected");
      onTransmit?.();
      if (this.kind === "adb") await this.shell!.write(bytes);
      else await this.writer!.write(bytes);
      this.metrics.transmitted += bytes.length;
    });
    this.queue = work.catch(() => {});
    return work;
  }
  cancelPaste() {
    this.pasteController?.abort();
    this.pasteWake?.();
  }
  async sendPaste(text: string, options: PasteOptions, token: string) {
    if (this.pasteController)
      throw new Error("A paste is already in progress.");
    if (this.state.status !== "connected" || token !== this.connectionToken())
      throw new Error("Connection changed; review the paste again.");
    const chunks = planPaste(text, {
      ...options,
      appendEnter: options.bracketed ? false : options.appendEnter,
    });
    // Validate all text before sending even the first line.
    const encodedChunks = chunks.map((chunk) =>
      encodeSerialText(
        chunk,
        this.kind === "serial" ? this.sendEncoding : "utf-8",
      ),
    );
    const controller = new AbortController();
    this.pasteController = controller;
    this.state = {
      ...this.state,
      pasting: true,
      pasteSent: 0,
      pasteTotal: chunks.length,
    };
    this.update(this.state.status, this.state.error);
    let bracketStarted = false;
    let completed = false;
    const check = () => {
      if (
        controller.signal.aborted ||
        token !== this.connectionToken() ||
        this.state.status !== "connected"
      )
        throw new Error("Paste canceled; unsent content was discarded.");
    };
    try {
      if (options.bracketed) {
        await this.enqueue("\x1b[200~");
        bracketStarted = true;
      }
      for (let i = 0; i < chunks.length; i++) {
        check();
        await this.enqueue(encodedChunks[i]);
        this.state = { ...this.state, pasteSent: i + 1 };
        this.update(this.state.status, this.state.error);
        if (i < chunks.length - 1 && options.delayMs)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, options.delayMs);
            this.pasteWake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
      }
      check();
      completed = true;
    } finally {
      this.pasteWake = undefined;
      try {
        if (
          bracketStarted &&
          token === this.connectionToken() &&
          this.state.status === "connected"
        ) {
          await this.enqueue("\x1b[201~");
          // A requested Enter must be outside the bracketed payload, otherwise
          // readline treats it as pasted text instead of executing the command.
          if (completed && options.appendEnter && !controller.signal.aborted)
            await this.enqueue(options.ending);
        }
      } finally {
        if (this.pasteController === controller)
          this.pasteController = undefined;
        this.state = { ...this.state, pasting: false };
        this.update(this.state.status, this.state.error);
      }
    }
  }
  disconnect(): Promise<void> {
    this.cancelPaste();
    this.closing = true;
    this.generation++;
    this.wakeRecovery?.();
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
    await this.closeSerial();
    await this.serialReadTask;
    this.serialReadTask = undefined;
    this.port = undefined;
    this.adb = undefined;
    this.shell = undefined;
    this.decoder = new TextDecoder(this.receiveEncoding);
    this.warn("");
    this.state = { ...this.state, detail: "" };
    this.update("disconnected");
  }
  private closeSerial(): Promise<void> {
    if (this.serialCloseTask) return this.serialCloseTask;
    this.serialCloseTask = this.releaseSerial().finally(() => {
      this.serialCloseTask = undefined;
    });
    return this.serialCloseTask;
  }
  private async releaseSerial() {
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
    } catch {
      /* unplugged */
    }
    try {
      await this.port?.close();
    } catch {
      /* already closed or unplugged */
    }
    this.writer = undefined;
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
