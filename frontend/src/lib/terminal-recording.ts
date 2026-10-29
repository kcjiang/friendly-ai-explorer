import { deviceLogStem } from "./device-log-name";
import type { DeviceSession } from "./device-session";

export type RecordingOptions = {
  raw: boolean;
  timestamps: boolean;
  rotateMiB: number;
};
export type CachedRecording = {
  id: string;
  stem?: string;
  kind: string;
  started: number;
  file: string;
  offset: number;
  part: number;
  pending: string;
  options: RecordingOptions;
};
export interface RecordingCache {
  put(value: CachedRecording): Promise<void>;
  remove(id: string): Promise<void>;
  list(): Promise<CachedRecording[]>;
}
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("fae-terminal-recordings", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("pending", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(
        new Error(
          "Log cache is blocked by another tab. Close other tabs and retry.",
        ),
      );
  });
}
async function cacheTransaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("pending", mode);
      const request = action(tx.objectStore("pending"));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () =>
        reject(tx.error || new Error("Log cache transaction aborted"));
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export const recordingCache: RecordingCache = {
  put: async (value) => {
    await cacheTransaction("readwrite", (store) => store.put(value));
  },
  remove: async (id) => {
    await cacheTransaction("readwrite", (store) => store.delete(id));
  },
  list: () => cacheTransaction("readonly", (store) => store.getAll()),
};

const liveRecordings = new Set<string>();
async function fileExists(directory: FileSystemDirectoryHandle, name: string) {
  try {
    await (await directory.getFileHandle(name)).getFile();
    return true;
  } catch (error) {
    if ((error as { name?: string } | null)?.name === "NotFoundError")
      return false;
    throw error;
  }
}
async function reserveStem(
  directory: FileSystemDirectoryHandle,
  kind: string,
  started: number,
) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const id = deviceLogStem(kind, new Date(started));
    let release: () => void;
    try {
      release = await acquireLease(id);
    } catch {
      continue;
    }
    try {
      if (!(await fileExists(directory, `${id}_001.log`)))
        return { id, release };
    } catch (error) {
      release();
      throw error;
    }
    release();
  }
  throw new Error("Log filename conflict. Please retry.");
}
async function acquireLease(id: string): Promise<() => void> {
  if (liveRecordings.has(id))
    throw new Error(
      "This recording is still open in another terminal. Stop it there first.",
    );
  if (typeof navigator === "undefined" || !navigator.locks) return () => {};
  return new Promise((resolve, reject) => {
    void navigator.locks
      .request(`fae-recording-${id}`, { ifAvailable: true }, (lock) => {
        if (!lock) {
          reject(new Error("This recording is active in another browser tab."));
          return;
        }
        return new Promise<void>((release) => resolve(release));
      })
      .catch(reject);
  });
}
/** Stateful ANSI removal; escape sequences may span serial/USB chunks. */
export class LogFormatter {
  private escape: "text" | "esc" | "intermediate" | "csi" | "osc" | "osc-esc" =
    "text";
  private lineStart = true;
  constructor(private options: RecordingOptions) {}
  format(data: string, time: number) {
    if (this.options.raw) return data;
    let result = "";
    for (const char of data) {
      const code = char.charCodeAt(0);
      if (this.escape === "osc") {
        if (code === 7 || code === 0x9c) this.escape = "text";
        else if (code === 27) this.escape = "osc-esc";
        continue;
      }
      if (this.escape === "osc-esc") {
        this.escape = char === "\\" ? "text" : "osc";
        continue;
      }
      if (this.escape === "esc") {
        this.escape =
          char === "["
            ? "csi"
            : "]PX^_".includes(char)
              ? "osc"
              : code >= 0x20 && code <= 0x2f
                ? "intermediate"
                : "text";
        continue;
      }
      if (this.escape === "intermediate") {
        if (code >= 0x30 && code <= 0x7e) this.escape = "text";
        continue;
      }
      if (this.escape === "csi") {
        if (code >= 0x40 && code <= 0x7e) this.escape = "text";
        continue;
      }
      if (code === 27) {
        this.escape = "esc";
        continue;
      }
      if (code === 0x9b) {
        this.escape = "csi";
        continue;
      }
      if ([0x90, 0x98, 0x9d, 0x9e, 0x9f].includes(code)) {
        this.escape = "osc";
        continue;
      }
      if (code >= 0x7f && code <= 0x9f) continue;
      if (code < 32 && char !== "\n" && char !== "\r" && char !== "\t")
        continue;
      if (
        this.lineStart &&
        this.options.timestamps &&
        char !== "\n" &&
        char !== "\r"
      )
        result += `[${new Date(time).toISOString()}] `;
      result += char;
      if (char === "\n") this.lineStart = true;
      else if (char !== "\r") this.lineStart = false;
    }
    return result;
  }
}

export class TerminalRecorder {
  private listeners = new Set<() => void>();
  private state = {
    id: "",
    status: "idle",
    bytes: 0,
    saved: 0,
    started: 0,
    elapsed: 0,
    directory: "",
    file: "",
    error: "",
    cacheError: "",
  };
  private record?: CachedRecording;
  private directory?: FileSystemDirectoryHandle;
  private formatter?: LogFormatter;
  private buffer = "";
  private accepting = false;
  private timer?: ReturnType<typeof setTimeout>;
  private lastDisk = 0;
  private job: Promise<void> = Promise.resolve();
  private stopping?: Promise<void>;
  private releaseLease?: () => void;
  private starting = false;
  private recovering = false;
  constructor(
    readonly kind: string,
    private cache: RecordingCache = recordingCache,
  ) {}
  snapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private update(value: Partial<typeof this.state>) {
    this.state = {
      ...this.state,
      ...value,
      elapsed: this.state.started
        ? Math.floor((Date.now() - this.state.started) / 1000)
        : 0,
    };
    this.listeners.forEach((fn) => fn());
  }
  async start(directory: FileSystemDirectoryHandle, options: RecordingOptions) {
    if (
      this.starting ||
      this.accepting ||
      this.stopping ||
      this.recovering ||
      this.state.status === "error"
    )
      throw new Error("Finish or recover the previous recording first.");
    this.starting = true;
    try {
      await this.begin(directory, options);
    } finally {
      this.starting = false;
    }
  }
  private async begin(
    directory: FileSystemDirectoryHandle,
    options: RecordingOptions,
  ) {
    const started = Date.now();
    const { id: stem, release } = await reserveStem(
      directory,
      this.kind,
      started,
    );
    // Cache and recovery locks retain a full UUID; the short suffix is only for filenames.
    const id = crypto.randomUUID();
    this.record = {
      id,
      stem,
      kind: this.kind,
      started,
      file: `${stem}_001.log`,
      part: 1,
      offset: 0,
      pending: "",
      options: {
        ...options,
        rotateMiB: Math.min(64, Math.max(1, options.rotateMiB || 4)),
      },
    };
    // Fail before accepting output if recovery storage is unavailable.
    try {
      const releaseCache = await acquireLease(id);
      this.releaseLease = () => {
        releaseCache();
        release();
      };
      await this.cache.put(this.record);
    } catch (error) {
      this.releaseLease?.();
      if (!this.releaseLease) release();
      this.releaseLease = undefined;
      throw error;
    }
    liveRecordings.add(id);
    this.directory = directory;
    this.formatter = new LogFormatter(options);
    this.buffer = "";
    this.accepting = true;
    this.lastDisk = Date.now();
    this.update({
      id,
      status: "recording",
      started,
      bytes: 0,
      saved: 0,
      directory: directory.name,
      file: this.record.file,
      error: "",
      cacheError: "",
    });
    this.schedule();
  }
  append(data: string) {
    if (!this.accepting) return;
    const formatted = this.formatter!.format(data, Date.now());
    this.buffer += formatted;
    this.state = {
      ...this.state,
      bytes: this.state.bytes + new TextEncoder().encode(formatted).length,
    };
    if (this.buffer.length > 4 * 1024 * 1024) {
      this.accepting = false;
      this.update({
        status: "error",
        error:
          "Log output exceeded the save queue limit. Recording stopped; recover the pending data before starting again.",
      });
    }
  }
  private schedule() {
    this.timer = setTimeout(() => {
      this.job = this.job
        .then(() => this.checkpoint(Date.now() - this.lastDisk >= 2000))
        .catch((error) => this.fail(error));
      void this.job.then(() => {
        if (this.accepting) this.schedule();
      });
    }, 250);
  }
  private async fail(error: unknown) {
    this.accepting = false;
    clearTimeout(this.timer);
    this.update({ status: "error", error: String(error) });
    try {
      await this.persist();
    } catch (cacheError) {
      this.update({ cacheError: String(cacheError) });
    }
  }
  private async persist() {
    if (!this.record) return;
    await this.cache.put({
      ...this.record,
      pending: this.record.pending + this.buffer,
    });
  }
  private async checkpoint(disk: boolean) {
    if (!this.record) return;
    if (disk) {
      this.record.pending += this.buffer;
      this.buffer = "";
      const bytes = new TextEncoder().encode(this.record.pending).length;
      if (
        this.record.offset &&
        this.record.offset + bytes > this.record.options.rotateMiB * 1024 * 1024
      ) {
        this.record.part++;
        this.record.offset = 0;
        this.record.file = `${this.record.stem || this.record.id}_${String(this.record.part).padStart(3, "0")}.log`;
      }
    }
    await this.persist();
    if (disk) {
      // Incoming output stays in buffer while this immutable batch is saved.
      if (this.record.pending) {
        await this.writePending();
        // Cache progress only after close() confirms the file commit.
        await this.persist();
      }
      this.lastDisk = Date.now();
    }
    this.update({});
  }
  private async writePending() {
    const record = this.record!;
    const bytes = new TextEncoder().encode(record.pending);
    if (!record.offset && (await fileExists(this.directory!, record.file)))
      throw new Error(
        "Log file already exists. Recover pending output to a new file.",
      );
    const file = await this.directory!.getFileHandle(record.file, {
      create: true,
    });
    const stream = await file.createWritable({ keepExistingData: true });
    try {
      await stream.seek(record.offset);
      await stream.write(bytes);
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => {});
      throw error;
    }
    record.offset += bytes.length;
    record.pending = "";
    this.update({ file: record.file, saved: this.state.saved + bytes.length });
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    if (
      !this.record ||
      this.state.status === "stopped" ||
      this.state.status === "idle"
    )
      return Promise.resolve();
    this.accepting = false;
    clearTimeout(this.timer);
    this.update({ status: "saving" });
    this.stopping = this.job
      .then(async () => {
        await this.checkpoint(true);
        await this.cache.remove(this.record!.id);
        this.release();
        this.update({ status: "stopped", error: "", cacheError: "" });
      })
      .catch((error) => this.fail(error))
      .finally(() => {
        this.stopping = undefined;
      });
    this.job = this.stopping;
    return this.stopping;
  }
  async exportPending() {
    await this.job;
    return new Blob([this.record?.pending || "", this.buffer], {
      type: "text/plain;charset=utf-8",
    });
  }
  async savePendingTo(directory: FileSystemDirectoryHandle) {
    if (this.accepting || this.state.status === "saving" || this.recovering)
      throw new Error("Stop recording before recovering pending data.");
    this.recovering = true;
    try {
      await this.job;
      if (!this.record) return;
      await writeRecovery(
        this.record,
        this.record.pending + this.buffer,
        directory,
      );
      await this.cache.remove(this.record.id);
      this.release();
      this.record.pending = "";
      this.buffer = "";
      this.update({
        status: "stopped",
        saved: this.state.bytes,
        error: "",
        cacheError: "",
        directory: directory.name,
      });
    } finally {
      this.recovering = false;
    }
  }
  private release() {
    if (this.record) liveRecordings.delete(this.record.id);
    this.releaseLease?.();
    this.releaseLease = undefined;
  }
}
const recorders = new WeakMap<DeviceSession, TerminalRecorder>();
export function getTerminalRecorder(
  session: DeviceSession,
  cache: RecordingCache = recordingCache,
) {
  let recorder = recorders.get(session);
  if (!recorder) {
    recorder = new TerminalRecorder(session.kind, cache);
    recorders.set(session, recorder);
    session.observeOutput((data) => recorder!.append(data));
    session.observeAnnotations((data) => recorder!.append(data));
    session.subscribe(() => {
      const status = session.snapshot().status;
      if (
        ["disconnecting", "disconnected"].includes(status) &&
        recorder!.snapshot().status === "recording"
      )
        void recorder!.stop();
    });
  }
  return recorder;
}
export async function chooseLogDirectory() {
  const picker = (
    window as unknown as {
      showDirectoryPicker?: (options: {
        mode: string;
      }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  if (!picker)
    throw new Error(
      "Directory saving requires Chrome or Edge over HTTPS or localhost.",
    );
  return picker.call(window, { mode: "readwrite" });
}
export async function recoverCachedRecording(
  record: CachedRecording,
  directory: FileSystemDirectoryHandle,
  cache: RecordingCache = recordingCache,
) {
  const release = await acquireLease(record.id);
  try {
    const latest = (await cache.list()).find((item) => item.id === record.id);
    if (!latest)
      throw new Error(
        "This recording has already been saved or removed. Reopen the log menu to refresh.",
      );
    record = latest;
    await writeRecovery(record, record.pending, directory);
    await cache.remove(record.id);
  } finally {
    release();
  }
}
async function writeRecovery(
  record: CachedRecording,
  text: string,
  directory: FileSystemDirectoryHandle,
) {
  const bytes = new TextEncoder().encode(text);
  if (!bytes.length) return;
  let committed = 0;
  try {
    // A crash can happen after the file commit but before cache progress is
    // updated. Compare exact bytes in the original folder before recovering.
    const original = await (
      await directory.getFileHandle(record.file)
    ).getFile();
    const existing = new Uint8Array(
      await original
        .slice(record.offset, record.offset + bytes.length)
        .arrayBuffer(),
    );
    if (existing.every((byte, i) => byte === bytes[i]))
      committed = existing.length;
  } catch {
    /* a different recovery folder or a missing original file */
  }
  // Recovery files must start at a UTF-8 character boundary even if the
  // original was externally truncated in the middle of a character.
  while (
    committed > 0 &&
    committed < bytes.length &&
    (bytes[committed] & 0xc0) === 0x80
  )
    committed--;
  if (committed === bytes.length) return;
  const { id, release } = await reserveStem(
    directory,
    record.kind,
    record.started,
  );
  try {
    const file = await directory.getFileHandle(`${id}_001.log`, {
      create: true,
    });
    const stream = await file.createWritable();
    try {
      await stream.write(bytes.slice(committed));
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => {});
      throw error;
    }
  } finally {
    release();
  }
}
