const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { webcrypto } = require("node:crypto");
function loader(globals = {}) {
  const modules = new Map();
  const load = (name) => {
    if (modules.has(name)) return modules.get(name);
    const exports = {};
    modules.set(name, exports);
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
        require: (id) => (id.startsWith("./") ? load(id.slice(2) + ".ts") : {}),
        TextDecoder,
        TextEncoder,
        DataView,
        Uint8Array,
        Blob,
        AbortController,
        crypto: webcrypto,
        setTimeout,
        clearTimeout,
        ...globals,
      },
    );
    return exports;
  };
  return load;
}
const pause = () => new Promise((resolve) => setImmediate(resolve));
const pasteOptions = {
  delayMs: 0,
  ending: "\r",
  appendEnter: false,
  bracketed: false,
};
function serialSession(globals) {
  const load = loader(globals);
  const { DeviceSession } = load("device-session.ts");
  const session = new DeviceSession("serial");
  session.update("connected");
  const writes = [];
  session.writer = {
    write: async (bytes) => writes.push(new TextDecoder().decode(bytes)),
  };
  return { load, session, writes };
}

test("shell v2 frames decode fragmented headers, multibyte payloads and coalesced messages", () => {
  const { shellPacket, ShellOutputDecoder } = loader()("adb-shell-protocol.ts");
  let result = "",
    exits = 0;
  const utf8 = new TextDecoder();
  const decoder = new ShellOutputDecoder(
    (data) => {
      result += utf8.decode(data, { stream: true });
    },
    () => exits++,
  );
  const frames = [
    shellPacket(1, new TextEncoder().encode("中文")),
    shellPacket(2, new TextEncoder().encode("stderr")),
    shellPacket(3, new Uint8Array([0])),
  ];
  for (const frame of frames)
    for (const byte of frame) decoder.push(new Uint8Array([byte]));
  assert.equal(result, "中文stderr");
  assert.equal(exits, 1);
  assert.throws(
    () =>
      new ShellOutputDecoder(
        () => {},
        () => {},
      ).push(new Uint8Array([9, 0, 0, 0, 0])),
    /Invalid/,
  );
  assert.throws(
    () =>
      new ShellOutputDecoder(
        () => {},
        () => {},
      ).push(new Uint8Array([1, 255, 255, 255, 127])),
    /Invalid/,
  );
});

test("interactive ADB negotiates PTY, frames stdin separately from window changes and closes once", async () => {
  const load = loader();
  const { AdbDevice } = load("adb-webusb.ts");
  const { shellPacket } = load("adb-shell-protocol.ts");
  const device = new AdbDevice({}, {});
  device.running = true;
  device.acceptConnection({
    cmd: 0x4e584e43,
    data: new TextEncoder().encode("device::features=cmd,shell_v2;\0"),
  });
  const services = [],
    packets = [];
  let closed = 0,
    output = "";
  device.open = async (_, service) => {
    services.push(service);
    return 7;
  };
  device.send = async (command, lid, _, data) => {
    if (command === 0x45545257) {
      packets.push(data);
      queueMicrotask(() => device.streams.get(lid).ready());
    }
  };
  const shell = await device.interactive(
    (data) => {
      output += new TextDecoder().decode(data);
    },
    () => closed++,
  );
  await shell.write(new TextEncoder().encode("echo test\r"));
  await shell.resize(132, 40);
  assert.equal(services[0], "shell,v2,pty,TERM=xterm-256color:");
  assert.equal(packets[0][0], 0);
  assert.equal(new TextDecoder().decode(packets[0].slice(5)), "echo test\r");
  assert.equal(packets[1][0], 5);
  assert.equal(new TextDecoder().decode(packets[1].slice(5)), "40x132,0x0\0");
  device.streams
    .get(1)
    .onData(shellPacket(1, new TextEncoder().encode("ready")));
  device.streams.get(1).onData(shellPacket(3, new Uint8Array([0])));
  device.streams.get(1).onClose();
  assert.equal(output, "ready");
  assert.equal(closed, 1);
  await assert.rejects(shell.write(new Uint8Array([1])), /closed/);
});

test("ADB falls back only on service rejection and never injects resize text into legacy stdin", async () => {
  const { AdbDevice } = loader()("adb-webusb.ts");
  const device = new AdbDevice({}, {});
  device.running = true;
  device.shellV2 = true;
  const services = [],
    sent = [];
  let closed = 0;
  device.open = async (_, service) => {
    services.push(service);
    if (services.length === 1) throw new Error("ADB service closed");
    return 8;
  };
  device.send = async (command, lid, _, data) => {
    sent.push(data);
    queueMicrotask(() => device.streams.get(lid).ready());
  };
  const shell = await device.interactive(
    () => {},
    () => closed++,
  );
  assert.equal(await shell.resize(100, 30), false);
  await shell.write(new TextEncoder().encode("top\r"));
  assert.equal(services[1], "shell:");
  assert.equal(closed, 0);
  assert.equal(new TextDecoder().decode(sent[0]), "top\r");
  assert.equal(sent.length, 1);
});

test("ADB ACK timeout closes the stream so a late ACK cannot release the next write", async () => {
  const timers = new Map();
  let id = 0;
  const { AdbDevice } = loader({
    setTimeout: (fn) => {
      timers.set(++id, fn);
      return id;
    },
    clearTimeout: (key) => timers.delete(key),
  })("adb-webusb.ts");
  const device = new AdbDevice({}, {});
  device.running = true;
  device.open = async () => 7;
  const commands = [];
  device.send = async (cmd) => {
    commands.push(cmd);
  };
  const shell = await device.interactive(
    () => {},
    () => {},
  );
  const first = assert.rejects(shell.write(new Uint8Array([1])), /timeout/);
  const next = assert.rejects(shell.write(new Uint8Array([2])), /closed/);
  await pause();
  const [timerId, callback] = timers.entries().next().value;
  timers.delete(timerId);
  callback();
  await Promise.all([first, next]);
  assert.equal(device.streams.size, 0);
  assert.equal(commands.filter((cmd) => cmd === 0x45545257).length, 1);
  assert.equal(commands.includes(0x45534c43), true);
});

test("paste planning preserves endings and surrogate pairs without automatically appending Enter", () => {
  const { planPaste } = loader()("terminal-paste.ts");
  assert.deepEqual(
    [...planPaste("one\r\ntwo", pasteOptions)],
    ["one\r", "two"],
  );
  assert.deepEqual(
    [
      ...planPaste("one\ntwo\n", {
        ...pasteOptions,
        ending: "\r\n",
        appendEnter: true,
      }),
    ],
    ["one\r\n", "two\r\n"],
  );
  const text = "a".repeat(255) + "😀" + "b";
  assert.equal(planPaste(text, pasteOptions).join(""), text);
  assert.ok(
    planPaste(text, pasteOptions).every(
      (part) => !/[\uD800-\uDBFF]$/.test(part),
    ),
  );
  const crlf = planPaste("a".repeat(255) + "\n", {
    ...pasteOptions,
    ending: "\r\n",
  });
  assert.equal(crlf[0].endsWith("\r"), false);
  for (const text of ["x\x1b[31m", "x".repeat(65537), "x\n".repeat(2000)])
    assert.throws(() => planPaste(text, pasteOptions));
});

test("paste requires the current connection token and validates GBK before transmitting", async () => {
  const { session, writes } = serialSession();
  await assert.rejects(
    session.sendPaste("test", pasteOptions, "stale"),
    /Connection changed/,
  );
  session.sendEncoding = "gbk";
  await assert.rejects(
    session.sendPaste("safe\n😀", pasteOptions, session.connectionToken()),
    /cannot encode/,
  );
  assert.deepEqual(writes, []);
});

test("paced paste has one write in flight, rejects interleaved input and cancels queued lines", async () => {
  const timers = new Map();
  let id = 0;
  const { session, writes } = serialSession({
    setTimeout: (fn) => {
      timers.set(++id, fn);
      return id;
    },
    clearTimeout: (key) => timers.delete(key),
  });
  const sending = session.sendPaste(
    "one\ntwo\nthree",
    { ...pasteOptions, delayMs: 200 },
    session.connectionToken(),
  );
  const canceled = assert.rejects(sending, /canceled/);
  await pause();
  assert.deepEqual(writes, ["one\r"]);
  await assert.rejects(session.write("interleaved"), /in progress/);
  session.cancelPaste();
  await canceled;
  assert.deepEqual(writes, ["one\r"]);
  assert.equal(timers.size, 0);
  assert.equal(session.snapshot().pasting, false);
  await session.write("new\r");
  assert.equal(writes[1], "new\r");
});

test("bracketed paste is closed on cancellation without replaying payload", async () => {
  const timers = new Map();
  let id = 0;
  const { session, writes } = serialSession({
    setTimeout: (fn) => {
      timers.set(++id, fn);
      return id;
    },
    clearTimeout: (key) => timers.delete(key),
  });
  const sending = session.sendPaste(
    "one\ntwo",
    { ...pasteOptions, bracketed: true, delayMs: 100 },
    session.connectionToken(),
  );
  const canceled = assert.rejects(sending, /canceled/);
  await pause();
  session.cancelPaste();
  await canceled;
  assert.deepEqual(writes, ["\x1b[200~", "one\r", "\x1b[201~"]);
});

test("connection loss wakes paste delay and never sends its tail to a recovered transport", async () => {
  const timers = new Map();
  let id = 0;
  const { session, writes } = serialSession({
    setTimeout: (fn) => {
      timers.set(++id, fn);
      return id;
    },
    clearTimeout: (key) => timers.delete(key),
  });
  const sending = session.sendPaste(
    "one\ntwo",
    { ...pasteOptions, delayMs: 5000 },
    session.connectionToken(),
  );
  const canceled = assert.rejects(sending, /canceled/);
  await pause();
  session.update("reconnecting");
  session.transportVersion++;
  await canceled;
  session.writer = {
    write: async () => {
      throw new Error("must not replay");
    },
  };
  session.update("connected");
  await pause();
  assert.deepEqual(writes, ["one\r"]);
  assert.equal(timers.size, 0);
});

test("an explicitly requested Enter is outside bracketed paste and omitted by default", async () => {
  const { session, writes } = serialSession();
  await session.sendPaste(
    "echo test",
    { ...pasteOptions, bracketed: true, appendEnter: true },
    session.connectionToken(),
  );
  assert.deepEqual(writes, ["\x1b[200~", "echo test", "\x1b[201~", "\r"]);
  writes.length = 0;
  await session.sendPaste(
    "echo test",
    { ...pasteOptions, bracketed: true },
    session.connectionToken(),
  );
  assert.deepEqual(writes, ["\x1b[200~", "echo test", "\x1b[201~"]);
});

test("profiles round-trip settings without credentials, device selection or automatic recording", () => {
  const load = loader();
  const { DeviceSession } = load("device-session.ts");
  const api = load("terminal-profiles.ts");
  const session = new DeviceSession("serial");
  session.configure({
    profileName: "Board",
    pasteDelayMs: 120,
    lineEnding: "\r",
    recordingOptions: { raw: true, timestamps: false, rotateMiB: 16 },
  });
  session.setSendEncoding("gbk");
  const p = api.captureProfile(session, "中文主板", "profile-test");
  const sanitized = api.validateProfile({
    ...p,
    password: "secret",
    port: "COM3",
    autoRecord: true,
  });
  assert.equal(JSON.stringify(sanitized).includes("secret"), false);
  assert.equal(sanitized.autoRecord, undefined);
  let data = "";
  const storage = {
    setItem: (_, value) => {
      data = value;
    },
    getItem: () => data,
  };
  api.saveProfiles([p], storage);
  const restored = api.readProfiles(storage)[0];
  session.configure({ pasteDelayMs: 0 });
  api.applyProfile(session, restored);
  assert.equal(session.pasteDelayMs, 120);
  assert.equal(session.sendEncoding, "gbk");
  assert.equal(session.profileName, "中文主板");
  assert.equal(session.snapshot().status, "disconnected");
  session.update("connected");
  assert.throws(() => api.applyProfile(session, restored), /Disconnect/);
  assert.throws(() => api.saveProfiles([p, p], storage), /Duplicate/);
  assert.throws(() => api.readProfiles({ getItem: () => "broken json" }));
});

test("diagnostics count payloads and bound events, while notes never become device commands", async () => {
  const { session, writes } = serialSession();
  const notes = [];
  session.observeAnnotations((text) => notes.push(text));
  session.bytes(new Uint8Array([65, 66]));
  await session.write("中文");
  session.addAnnotation("开始升级\x1b\n");
  assert.equal(writes.length, 1);
  assert.match(notes[0], /FAE NOTE/);
  assert.equal(notes[0].includes("\x1b"), false);
  for (let i = 0; i < 150; i++) session.warn("warning-" + i);
  const diag = session.getDiagnostics();
  assert.equal(diag.received, 2);
  assert.equal(diag.transmitted, 6);
  assert.equal(diag.events.length, 100);
  assert.equal(diag.annotations, 1);
  assert.equal(JSON.stringify(diag).includes("开始升级"), false);
  assert.equal(JSON.stringify(diag).includes("中文"), false);
});
