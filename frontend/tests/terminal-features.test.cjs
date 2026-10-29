const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { webcrypto } = require("node:crypto");

function load(name, extra = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(path.join(__dirname, "../src/lib", name), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      exports,
      Error,
      require: (name) =>
        name === "./device-log-name" ? load("device-log-name.ts", extra) : {},
      TextDecoder,
      TextEncoder,
      Uint8Array,
      Blob,
      AbortController,
      crypto: webcrypto,
      setTimeout,
      clearTimeout,
      ...extra,
    },
  );
  return exports;
}
function harness() {
  const records = new Map(),
    files = new Map(),
    timers = new Map(),
    events = [];
  let now = Date.now(),
    id = 0;
  class ClockDate extends Date {
    static now() {
      return now;
    }
  }
  const cache = {
    fail: false,
    put: async (item) => {
      if (cache.fail) throw new Error("cache quota");
      records.set(item.id, structuredClone(item));
      events.push("cache");
    },
    remove: async (key) => {
      records.delete(key);
    },
    list: async () => [...records.values()],
  };
  const dir = {
    name: "test logs",
    fail: false,
    getFileHandle: async (name) => ({
      getFile: async () => {
        if (!files.has(name))
          throw Object.assign(new Error("not found"), {
            name: "NotFoundError",
          });
        return new Blob([files.get(name)]);
      },
      createWritable: async () => {
        let offset = 0,
          data = files.get(name) || new Uint8Array();
        return {
          seek: async (n) => {
            offset = n;
          },
          write: async (value) => {
            if (dir.fail) throw new Error("disk full");
            const incoming =
              typeof value === "string"
                ? new TextEncoder().encode(value)
                : value;
            const next = new Uint8Array(
              Math.max(data.length, offset + incoming.length),
            );
            next.set(data);
            next.set(incoming, offset);
            data = next;
          },
          close: async () => {
            events.push("commit");
            files.set(name, data);
          },
          abort: async () => {},
        };
      },
    }),
  };
  const api = load("terminal-recording.ts", {
    Date: ClockDate,
    setTimeout: (fn, ms) => {
      timers.set(++id, { fn, ms });
      return id;
    },
    clearTimeout: (key) => timers.delete(key),
  });
  const recorder = new api.TerminalRecorder("serial", cache);
  const tick = async (ms) => {
    now += ms;
    const entry = timers.entries().next().value;
    if (entry) {
      timers.delete(entry[0]);
      entry[1].fn();
    }
    await new Promise((r) => setImmediate(r));
  };
  return { ...api, recorder, cache, dir, files, records, timers, events, tick };
}
const options = { raw: false, timestamps: false, rotateMiB: 4 };

test("device log names use local wall time and a four-digit hex suffix for both transports", () => {
  const { deviceLogName } = load("device-log-name.ts", {
    crypto: {
      getRandomValues: (buffer) => {
        buffer[0] = 0xa1b2;
        return buffer;
      },
    },
  });
  const local = new Date(2026, 9, 29, 14, 35, 8);
  assert.equal(deviceLogName("adb", local), "adb_20261029_143508_a1b2.log");
  assert.equal(
    deviceLogName("serial", local),
    "serial_20261029_143508_a1b2.log",
  );
});

test("display preferences clamp invalid values and retain Chinese-capable font fallback", () => {
  const { normalizeTerminalPreferences, terminalFonts } = load(
    "terminal-preferences.ts",
  );
  assert.equal(normalizeTerminalPreferences({ fontSize: 100 }).fontSize, 28);
  assert.equal(
    normalizeTerminalPreferences({
      fontSize: NaN,
      lineHeight: -8,
      font: "__proto__",
      theme: "constructor",
    }).fontSize,
    13,
  );
  assert.equal(normalizeTerminalPreferences({ lineHeight: -8 }).lineHeight, 1);
  assert.equal(
    normalizeTerminalPreferences({ font: "__proto__" }).font,
    "consolas",
  );
  assert.match(terminalFonts.consolas, /Microsoft YaHei/);
});

test("Chinese GBK sending produces exact bytes and rejects unrepresentable text", () => {
  const { encodeSerialText } = load("serial-text.ts");
  assert.deepEqual(
    [...encodeSerialText("中文\r", "gbk")],
    [0xd6, 0xd0, 0xce, 0xc4, 13],
  );
  assert.equal(
    new TextDecoder().decode(encodeSerialText("中文😀", "utf-8")),
    "中文😀",
  );
  assert.throws(() => encodeSerialText("😀", "gbk"), /cannot encode/);
  assert.deepEqual([...encodeSerialText("\x03\x1b[A", "gbk")], [3, 27, 91, 65]);
});

test("plain log formatter handles split ANSI/OSC and timestamps logical lines once", () => {
  const { LogFormatter } = load("terminal-recording.ts");
  const formatter = new LogFormatter({ ...options, timestamps: true });
  const stamp = "[1970-01-01T00:00:00.000Z] ";
  const output =
    formatter.format("\x1b[3", 0) +
    formatter.format("1m中", 0) +
    formatter.format("文\x1b[0m\r\n\x1b]0;title", 0) +
    formatter.format("\x1b\\next", 0);
  assert.equal(output, stamp + "中文\r\n" + stamp + "next");
  const raw = new LogFormatter({ ...options, raw: true, timestamps: true });
  assert.equal(raw.format("\x1b[31m中文\r\n", 0), "\x1b[31m中文\r\n");
  const charset = new LogFormatter(options);
  assert.equal(
    charset.format("\x1b(", 0) +
      charset.format("B中文\x1bPignored\x1b\\text", 0),
    "中文text",
  );
});

test("recording is manual, creates no empty log files and does not include prior output", async () => {
  const h = harness();
  h.recorder.append("before recording");
  assert.equal(h.timers.size, 0);
  assert.equal(h.records.size, 0);
  await h.recorder.start(h.dir, options);
  await h.recorder.stop();
  assert.equal(h.files.size, 0);
  assert.equal(h.records.size, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.recorder.snapshot().status, "stopped");
});

test("cache precedes file commit, saved text is appended once and stop flushes the tail", async () => {
  const h = harness();
  await h.recorder.start(h.dir, options);
  h.recorder.append("\x1b[32m启动\x1b[0m\r\n");
  await h.tick(250);
  assert.equal([...h.records.values()][0].pending, "启动\r\n");
  assert.equal(h.files.size, 0);
  await h.tick(2000);
  h.recorder.append("ready>");
  await h.recorder.stop();
  assert.equal(
    new TextDecoder().decode([...h.files.values()][0]),
    "启动\r\nready>",
  );
  assert.ok(h.events.indexOf("cache") < h.events.indexOf("commit"));
  assert.equal(
    h.recorder.snapshot().saved,
    new TextEncoder().encode("启动\r\nready>").length,
  );
  assert.equal(h.records.size, 0);
});

test("failed disk save stops recording, preserves unsaved cache and supports another directory", async () => {
  const h = harness();
  await h.recorder.start(h.dir, options);
  h.recorder.append("important中文");
  h.dir.fail = true;
  await h.tick(2100);
  assert.equal(h.recorder.snapshot().status, "error");
  assert.match(h.recorder.snapshot().error, /disk full/);
  assert.equal([...h.records.values()][0].pending, "important中文");
  h.recorder.append("not accepted after error");
  h.dir.fail = false;
  await h.recorder.savePendingTo(h.dir);
  assert.equal(
    new TextDecoder().decode([...h.files.values()][0]),
    "important中文",
  );
  assert.equal(h.recorder.snapshot().status, "stopped");
  assert.equal(h.records.size, 0);
});

test("cache failure is surfaced and pending data remains exportable from memory", async () => {
  const h = harness();
  await h.recorder.start(h.dir, options);
  h.recorder.append("pending");
  h.cache.fail = true;
  await h.tick(250);
  assert.equal(h.recorder.snapshot().status, "error");
  assert.match(h.recorder.snapshot().cacheError, /cache quota/);
  assert.equal(await (await h.recorder.exportPending()).text(), "pending");
  h.cache.fail = false;
  await h.recorder.stop();
});

test("file rotation preserves UTF-8 and writes progress metadata for the new part before committing", async () => {
  const h = harness();
  await h.recorder.start(h.dir, { ...options, rotateMiB: 1 });
  const first = "a".repeat(1024 * 1024 - 4);
  h.recorder.append(first);
  await h.tick(2100);
  h.recorder.append("中文");
  await h.recorder.stop();
  const entries = [...h.files.entries()];
  assert.equal(entries.length, 2);
  assert.match(entries[0][0], /_001\.log$/);
  assert.match(entries[1][0], /_002\.log$/);
  assert.match(entries[0][0], /^serial_\d{8}_\d{6}_[0-9a-f]{4}_001\.log$/);
  assert.equal(entries[0][0].slice(0, -8), entries[1][0].slice(0, -8));
  assert.equal(
    new TextDecoder("utf-8", { fatal: true }).decode(entries[0][1]),
    first,
  );
  assert.equal(
    new TextDecoder("utf-8", { fatal: true }).decode(entries[1][1]),
    "中文",
  );
});

test("slow file commits do not lose output arriving while a batch is being saved", async () => {
  const h = harness();
  const originalGet = h.dir.getFileHandle;
  let release;
  h.dir.getFileHandle = async (name) => {
    const file = await originalGet(name);
    const create = file.createWritable;
    file.createWritable = async () => {
      const stream = await create();
      const close = stream.close;
      stream.close = async () => {
        await new Promise((resolve) => {
          release = resolve;
        });
        await close();
      };
      return stream;
    };
    return file;
  };
  await h.recorder.start(h.dir, options);
  h.recorder.append("first");
  await h.tick(2100);
  h.recorder.append("second");
  release();
  await new Promise((r) => setImmediate(r));
  h.dir.getFileHandle = originalGet;
  await h.recorder.stop();
  assert.equal(
    new TextDecoder().decode([...h.files.values()][0]),
    "firstsecond",
  );
});

test("display clearing never enters the recording stream and reconnecting does not stop it", async () => {
  const h = harness();
  const { DeviceSession } = load("device-session.ts", {
    require: (name) => (name === "./serial-text" ? load("serial-text.ts") : {}),
  });
  const session = new DeviceSession("serial");
  session.update("connected");
  const recorder = h.getTerminalRecorder(session, h.cache);
  session.output("before recording");
  assert.equal(recorder.snapshot().status, "idle");
  await recorder.start(h.dir, options);
  session.output("before clear\r\n");
  session.clear();
  session.update("reconnecting");
  assert.equal(recorder.snapshot().status, "recording");
  session.update("connected");
  session.output("after recovery\r\n");
  session.update("disconnecting");
  await recorder.stop();
  assert.equal(
    new TextDecoder().decode([...h.files.values()][0]),
    "before clear\r\nafter recovery\r\n",
  );
  assert.equal(recorder.snapshot().status, "stopped");
});

test("recovery refuses a live recording and retains crashed cache until a successful commit", async () => {
  const h = harness();
  await h.recorder.start(h.dir, options);
  h.recorder.append("recover me");
  await h.tick(250);
  const item = [...h.records.values()][0];
  await assert.rejects(
    h.recoverCachedRecording(item, h.dir, h.cache),
    /still open/,
  );
  // A new module simulates the page being reopened after a crash.
  const reopened = load("terminal-recording.ts");
  h.dir.fail = true;
  await assert.rejects(
    reopened.recoverCachedRecording(item, h.dir, h.cache),
    /disk full/,
  );
  assert.equal(h.records.size, 1);
  h.dir.fail = false;
  await reopened.recoverCachedRecording(item, h.dir, h.cache);
  assert.equal(h.records.size, 0);
  assert.equal(
    new TextDecoder().decode([...h.files.values()][0]),
    "recover me",
  );
  await assert.rejects(
    reopened.recoverCachedRecording(item, h.dir, h.cache),
    /already been saved/,
  );
  await h.recorder.stop();
});

test("notes are recorded once on a separate channel without changing terminal output", async () => {
  const h = harness();
  const { DeviceSession } = load("device-session.ts", { require: () => ({}) });
  const session = new DeviceSession("serial");
  session.update("connected");
  const recorder = h.getTerminalRecorder(session, h.cache);
  await recorder.start(h.dir, options);
  session.output("device prompt> ");
  session.addAnnotation("升级开始");
  assert.equal(session.transcript, "device prompt> ");
  await recorder.stop();
  const text = new TextDecoder().decode([...h.files.values()][0]);
  assert.match(text, /device prompt> \r\n\[FAE NOTE .*\] 升级开始\r\n/);
  assert.equal((text.match(/升级开始/g) || []).length, 1);
});

test("save backlog is bounded and overflow is explicit rather than silently dropping later output", async () => {
  const h = harness();
  await h.recorder.start(h.dir, options);
  const accepted = "a".repeat(4 * 1024 * 1024 + 1);
  h.recorder.append(accepted);
  assert.equal(h.recorder.snapshot().status, "error");
  h.recorder.append("not accepted");
  await h.tick(250);
  assert.equal([...h.records.values()][0].pending, accepted);
  await h.recorder.stop();
  assert.equal(h.recorder.snapshot().saved, accepted.length);
});

test("crash recovery in the original folder skips bytes already committed before cache progress updated", async () => {
  const h = harness();
  await h.recorder.start(h.dir, options);
  h.recorder.append("committed中文");
  await h.tick(250);
  const item = [...h.records.values()][0];
  h.files.set(item.file, new TextEncoder().encode(item.pending));
  const reopened = load("terminal-recording.ts");
  await reopened.recoverCachedRecording(item, h.dir, h.cache);
  assert.equal(
    h.files.size,
    1,
    "no redundant recovered file should be created",
  );
  assert.equal(h.records.size, 0);
  await h.recorder.stop();
});

test("many output batches keep complete logs across rotations without growing the pending cache", async () => {
  const h = harness();
  await h.recorder.start(h.dir, { ...options, rotateMiB: 1 });
  const block = "中文 ERROR line 0123456789\n".repeat(1000);
  for (let i = 0; i < 100; i++) {
    h.recorder.append(block);
    await h.tick(2100);
    assert.equal([...h.records.values()][0].pending, "");
  }
  await h.recorder.stop();
  const result = [...h.files.values()]
    .map((value) => new TextDecoder("utf-8", { fatal: true }).decode(value))
    .join("");
  assert.equal(result, block.repeat(100));
  assert.equal(
    h.recorder.snapshot().saved,
    new TextEncoder().encode(result).length,
  );
  assert.equal(h.records.size, 0);
  assert.equal(h.timers.size, 0);
});
