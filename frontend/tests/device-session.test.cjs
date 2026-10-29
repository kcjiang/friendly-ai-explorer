const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const {
  webcrypto,
  generateKeyPairSync,
  publicDecrypt,
  constants,
} = require("node:crypto");

function moduleFrom(file, mocks = {}, globals = {}, suffix = "") {
  const exports = {};
  const source =
    fs.readFileSync(path.join(__dirname, "../src/lib", file), "utf8") + suffix;
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    {
      exports,
      require: (name) =>
        mocks[name] ||
        (["./serial-text", "./terminal-paste", "./adb-shell-protocol"].includes(
          name,
        )
          ? moduleFrom(`${name.slice(2)}.ts`)
          : undefined),
      TextDecoder,
      TextEncoder,
      Uint8Array,
      DataView,
      AbortController,
      setTimeout,
      clearTimeout,
      crypto: webcrypto,
      ...globals,
    },
  );
  return exports;
}

test("ADB packet checksum is the sum of bytes and header magic is correct", () => {
  const { encodeMsg } = moduleFrom(
    "adb-webusb.ts",
    {},
    {},
    "\nexport { encodeMsg };",
  );
  const packet = encodeMsg(0x45545257, 1, 2, new Uint8Array([1, 128, 255]));
  const view = new DataView(packet.buffer);
  assert.equal(view.getUint32(16, true), 384);
  assert.equal(view.getUint32(20, true), (0x45545257 ^ 0xffffffff) >>> 0);
  assert.equal(view.getUint32(12, true), 3);
});

test("ADB authentication signs the token as an existing SHA-1 digest", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = privateKey.export({ format: "jwk" });
  const { AdbDevice } = moduleFrom(
    "adb-webusb.ts",
    {},
    { atob, localStorage: { getItem: () => JSON.stringify(jwk) } },
  );
  const device = new AdbDevice({}, {});
  const token = new Uint8Array(20).fill(42);
  const messages = [
    { cmd: 0x48545541, arg0: 1, data: token },
    { cmd: 0x4e584e43 },
  ];
  device.readMsg = async () => messages.shift();
  let signature;
  device.send = async (command, type, unused, data) => {
    assert.equal(type, 2);
    signature = data;
  };
  await device.doAuth();
  const signedDigest = publicDecrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_PADDING },
    signature,
  );
  assert.equal(
    signedDigest.subarray(-20).toString("hex"),
    Buffer.from(token).toString("hex"),
  );
  assert.equal(
    signedDigest.subarray(0, -20).toString("hex"),
    "3021300906052b0e03021a05000414",
  );
});

test("ADB open waiter and shell receiver exist before the device can reply", async () => {
  const { AdbDevice } = moduleFrom("adb-webusb.ts");
  const device = new AdbDevice({}, {});
  device.send = async (command, lid) => {
    const waiter = device.openWait.get(lid);
    assert.ok(waiter);
    assert.ok(device.streams.get(lid));
    waiter.resolve(9);
    device.openWait.delete(lid);
    device.streams.get(lid).onData(new TextEncoder().encode("hello"));
    device.streams.get(lid).onClose();
    device.streams.delete(lid);
  };
  let result = "";
  await device.shell("echo hello", (data) => (result += data));
  assert.equal(result, "hello");
  assert.equal(device.streams.size, 0);
});

test("interactive ADB waits for each OKAY before sending the next chunk", async () => {
  const { AdbDevice } = moduleFrom("adb-webusb.ts");
  const device = new AdbDevice({}, {});
  device.running = true;
  device.open = async () => 9;
  const chunks = [];
  device.send = async (command, lid, rid, data) => {
    chunks.push(data.length);
  };
  const shell = await device.interactive(
    () => {},
    () => {},
  );
  const writing = shell.write(new Uint8Array(5000));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(chunks, [4096]);
  device.streams.get(1).ready();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(chunks, [4096, 904]);
  device.streams.get(1).ready();
  await writing;
});

test("serial subscribers share one reader, preserve split UTF-8, and cancel before close", async () => {
  let requested = 0,
    reads = 0,
    complete,
    canceled = false;
  const port = {
    open: async () => {},
    readable: {
      getReader: () => ({
        read: async () => {
          reads++;
          if (reads === 1)
            return { value: new Uint8Array([0xe4, 0xb8]), done: false };
          if (reads === 2)
            return { value: new Uint8Array([0xad]), done: false };
          return new Promise((resolve) => {
            complete = resolve;
          });
        },
        cancel: async () => {
          canceled = true;
          complete({ done: true });
        },
        releaseLock: () => {},
      }),
    },
    writable: {
      getWriter: () => ({ write: async () => {}, releaseLock: () => {} }),
    },
    close: async () => {
      assert.ok(canceled);
    },
  };
  const { deviceSessions } = moduleFrom(
    "device-session.ts",
    { react: {}, "./adb-webusb": { checkWebSerialSupport: () => null } },
    {
      navigator: {
        serial: {
          requestPort: async () => {
            requested++;
            return port;
          },
        },
      },
    },
  );
  const session = deviceSessions.serial;
  let terminal = "",
    consoleLog = "";
  const unsubscribe = session.receive((data) => (terminal += data));
  session.receive((data) => (consoleLog += data));
  await session.connect();
  await new Promise((resolve) => setImmediate(resolve));
  await session.connect();
  assert.equal(requested, 1);
  assert.equal(terminal, "中");
  assert.equal(consoleLog, terminal);
  unsubscribe();
  await session.disconnect();
  assert.equal(session.snapshot().status, "disconnected");
});

test("transmission feedback follows the serial queue and never fires for disconnected writes", async () => {
  const { DeviceSession } = moduleFrom("device-session.ts", {
    react: {},
    "./adb-webusb": {},
  });
  const session = new DeviceSession("remote");
  session.update("connected");
  const events = [];
  let complete;
  session.writer = {
    write: () => {
      events.push("write");
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
  };
  const first = session.write(new Uint8Array([1]), () => events.push("first"));
  const second = session.write(new Uint8Array([2]), () =>
    events.push("second"),
  );
  await Promise.resolve();
  assert.deepEqual(events, ["first", "write"]);
  complete();
  await first;
  // Let the next queued write start.
  await Promise.resolve();
  assert.deepEqual(events, ["first", "write", "second", "write"]);
  complete();
  await second;
  session.update("disconnected");
  await assert.rejects(
    session.write(new Uint8Array([3]), () => events.push("invalid")),
    /disconnected/,
  );
  assert.ok(!events.includes("invalid"));
});

test("serial decoding diagnoses invalid UTF-8, supports split GBK, and resets across HEX", () => {
  const { DeviceSession } = moduleFrom("device-session.ts", {
    react: {},
    "./adb-webusb": {},
  });
  const session = new DeviceSession("serial");
  assert.equal(session.serialSettings.baudRate, 921600);
  assert.equal(new DeviceSession("remote").serialSettings.baudRate, 9600);
  let revisions = 0;
  session.subscribe(() => revisions++);
  session.setReceiveEncoding("gb18030");
  assert.equal(
    revisions,
    1,
    "encoding changes notify both settings panels even without a warning",
  );
  session.setReceiveEncoding("utf-8");
  session.bytes(new Uint8Array([0xff]));
  assert.equal(session.snapshot().warning, "decode");
  session.setReceiveEncoding("gb18030");
  session.clear();
  session.bytes(new Uint8Array([0xd6]));
  session.bytes(new Uint8Array([0xd0]));
  assert.equal(session.transcript, "中");
  assert.equal(session.snapshot().warning, "");
  session.setReceiveEncoding("utf-8");
  session.bytes(new Uint8Array([0xe4]));
  session.hex = true;
  session.bytes(new Uint8Array([0xff, 0x00]));
  session.hex = false;
  session.bytes(new TextEncoder().encode("OK"));
  assert.equal(session.transcript, "中ff 00\r\nOK");
});

for (const name of [
  "FramingError",
  "ParityError",
  "BufferOverrunError",
  "BreakError",
]) {
  test(`serial recovers ${name} and keeps keyboard writes available`, async () => {
    let firstController, nextController;
    const writes = [];
    let opened;
    const port = {
      open: async (settings) => {
        opened = settings;
      },
      readable: new ReadableStream({
        start: (c) => {
          firstController = c;
        },
      }),
      writable: new WritableStream({
        write: (data) => writes.push(Array.from(data)),
      }),
      close: async () => {
        assert.equal(port.readable.locked, false);
        assert.equal(port.writable.locked, false);
      },
    };
    const { DeviceSession, defaultSerial } = moduleFrom(
      "device-session.ts",
      {
        react: {},
        "./adb-webusb": { checkWebSerialSupport: () => null },
      },
      { navigator: { serial: { requestPort: async () => port } } },
    );
    const session = new DeviceSession("serial");
    await session.connect({ ...defaultSerial, baudRate: 1500000 });
    assert.equal(opened.baudRate, 1500000);
    assert.equal(opened.bufferSize, 65536);
    firstController.enqueue(new Uint8Array([0xe4]));
    await new Promise((resolve) => setImmediate(resolve));
    port.readable = new ReadableStream({
      start: (c) => {
        nextController = c;
      },
    });
    firstController.error(Object.assign(new Error(name), { name }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(session.snapshot().status, "connected");
    assert.equal(session.snapshot().warning, name);
    nextController.enqueue(new TextEncoder().encode("ready> "));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(session.transcript, "ready> ");
    assert.equal(session.snapshot().warning, "");
    await session.write("help\r\x03");
    assert.deepEqual(writes, [[104, 101, 108, 112, 13, 3]]);
    await session.disconnect();
    assert.equal(session.snapshot().status, "disconnected");
  });
}

test("fatal serial removal releases locks, preserves history and waits until manually stopped", async () => {
  let controller;
  const readable = new ReadableStream({
    start: (c) => {
      controller = c;
    },
  });
  const writable = new WritableStream();
  let closed = false;
  const port = {
    open: async () => {},
    readable,
    writable,
    close: async () => {
      closed = true;
    },
  };
  const { DeviceSession } = moduleFrom(
    "device-session.ts",
    {
      react: {},
      "./adb-webusb": { checkWebSerialSupport: () => null },
    },
    { navigator: { serial: { requestPort: async () => port } } },
  );
  const session = new DeviceSession("serial");
  await session.connect();
  session.output("boot log\r\n");
  port.readable = null;
  controller.error(
    Object.assign(new Error("Device removed"), { name: "NetworkError" }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.snapshot().status, "reconnecting");
  assert.equal(session.snapshot().error, "");
  assert.equal(session.transcript, "boot log\r\n");
  assert.equal(readable.locked, false);
  assert.equal(writable.locked, false);
  assert.equal(closed, true);
  await assert.rejects(session.write("do not replay\r"), /disconnected/);
  await session.disconnect();
  assert.equal(session.snapshot().status, "disconnected");
});

function fakeClock() {
  const timers = new Map();
  let id = 0;
  return {
    timers,
    setTimeout: (fn, ms) => {
      timers.set(++id, { fn, ms });
      return id;
    },
    clearTimeout: (key) => timers.delete(key),
    tick: async () => {
      const [key, timer] = timers.entries().next().value;
      timers.delete(key);
      timer.fn();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test("serial reopens only its original port with backoff and never replays offline commands", async () => {
  const clock = fakeClock();
  let controller,
    requests = 0,
    opens = 0;
  const writes = [];
  const port = {
    open: async () => {
      opens++;
      if (opens === 2) throw new Error("Still absent");
      port.readable = new ReadableStream({
        start: (c) => {
          controller = c;
        },
      });
      port.writable = new WritableStream({
        write: (data) => writes.push(new TextDecoder().decode(data)),
      });
    },
    close: async () => {},
  };
  const { DeviceSession } = moduleFrom(
    "device-session.ts",
    {
      react: {},
      "./adb-webusb": { checkWebSerialSupport: () => null },
    },
    {
      ...clock,
      navigator: {
        serial: {
          requestPort: async () => {
            requests++;
            return port;
          },
        },
      },
    },
  );
  const session = new DeviceSession("serial");
  await session.connect();
  session.output("history");
  let releaseQueue;
  session.queue = new Promise((resolve) => {
    releaseQueue = resolve;
  });
  const pendingWrite = session.write("queued-before-offline");
  const rejectedWrite = assert.rejects(pendingWrite, /disconnected/);
  port.readable = null;
  controller.error(new Error("removed"));
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(session.write("offline"), /disconnected/);
  releaseQueue();
  await rejectedWrite;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(clock.timers.values().next().value.ms, 500);
  await clock.tick();
  assert.equal(session.snapshot().status, "reconnecting");
  assert.equal(clock.timers.values().next().value.ms, 1000);
  await clock.tick();
  assert.equal(session.snapshot().status, "connected");
  assert.equal(session.transcript, "history");
  assert.equal(requests, 1);
  assert.deepEqual(writes, []);
  await session.write("fresh\r");
  assert.deepEqual(writes, ["fresh\r"]);
  await session.disconnect();
  assert.equal(clock.timers.size, 0);
});

function adbHandshakeHarness(messages, globals = {}) {
  const clock = fakeClock();
  const events = [];
  const dev = {
    configuration: {},
    open: async () => events.push("open"),
    close: async () => events.push("close"),
    claimInterface: async () => events.push("claim"),
    releaseInterface: async () => {},
  };
  const { AdbDevice } = moduleFrom(
    "adb-webusb.ts",
    {},
    { ...clock, ...globals },
    '\ngetOrCreateKey = async () => ({ privKey: {}, pubStr: "test" });',
  );
  const device = new AdbDevice(dev, { ifaceNum: 1 });
  device.send = async (cmd) => events.push(cmd);
  device.readMsg = async () => {
    const msg = messages.shift();
    if (msg instanceof Error) throw msg;
    return msg;
  };
  device.loop = async () => {};
  return { device, dev, clock, events };
}

test("manual serial disconnect waits for an in-flight reopen and cannot be undone by it", async () => {
  const clock = fakeClock();
  let controller,
    finishOpen,
    opens = 0;
  const port = {
    open: async () => {
      opens++;
      if (opens > 1)
        await new Promise((resolve) => {
          finishOpen = resolve;
        });
      port.readable = new ReadableStream({
        start: (c) => {
          controller = c;
        },
      });
      port.writable = new WritableStream();
    },
    close: async () => {},
  };
  const { DeviceSession } = moduleFrom(
    "device-session.ts",
    {
      react: {},
      "./adb-webusb": { checkWebSerialSupport: () => null },
    },
    { ...clock, navigator: { serial: { requestPort: async () => port } } },
  );
  const session = new DeviceSession("serial");
  await session.connect();
  port.readable = null;
  controller.error(new Error("removed"));
  await new Promise((resolve) => setImmediate(resolve));
  await clock.tick();
  const stopping = session.disconnect();
  finishOpen();
  await stopping;
  assert.equal(session.snapshot().status, "disconnected");
  assert.equal(session.port, undefined);
  assert.equal(session.writer, undefined);
  assert.equal(clock.timers.size, 0);
});

test("ADB authorization wait uses a longer timeout and never retries the approval prompt", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = privateKey.export({ format: "jwk" });
  const token = { cmd: 0x48545541, arg0: 1, data: new Uint8Array(20).fill(1) };
  const h = adbHandshakeHarness([token, token], {
    atob,
    localStorage: { getItem: () => JSON.stringify(jwk) },
  });
  const originalRead = h.device.readMsg;
  let reads = 0,
    rejectRead;
  h.device.readMsg = () =>
    ++reads <= 2
      ? originalRead()
      : new Promise((_, reject) => {
          rejectRead = reject;
        });
  h.dev.close = async () => rejectRead?.(new Error("closed"));
  const connecting = h.device.connect();
  const failed = assert.rejects(
    connecting,
    /authorization timed out.*Allow USB debugging/,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.clock.timers.values().next().value.ms, 60000);
  await h.clock.tick();
  await failed;
  assert.equal(h.events.includes("open"), false);
  assert.equal(h.clock.timers.size, 0);
});

test("canceling a device picker prevents its late result from reconnecting", async () => {
  let pick,
    opens = 0;
  const { DeviceSession } = moduleFrom(
    "device-session.ts",
    {
      react: {},
      "./adb-webusb": { checkWebSerialSupport: () => null },
    },
    {
      navigator: {
        serial: {
          requestPort: () =>
            new Promise((resolve) => {
              pick = resolve;
            }),
        },
      },
    },
  );
  const session = new DeviceSession("serial");
  const connecting = session.connect();
  await session.disconnect();
  pick({
    open: async () => {
      opens++;
    },
  });
  await connecting;
  assert.equal(session.snapshot().status, "disconnected");
  assert.equal(opens, 0);
});

test("ADB retries stale stream packets on the same device and connects without another picker", async () => {
  const h = adbHandshakeHarness([
    { cmd: 0x45545257, arg0: 4, arg1: 5 },
    { cmd: 0x4e584e43 },
  ]);
  const statuses = [];
  await h.device.connect((status, detail) => statuses.push({ status, detail }));
  assert.equal(h.device.isConnected, true);
  assert.deepEqual(
    h.events.filter((x) => typeof x === "string"),
    ["close", "open", "claim"],
  );
  assert.match(
    statuses.find((s) => s.status === "connecting" && s.detail).detail,
    /WRTE.*arg0=4/,
  );
  assert.equal(h.clock.timers.size, 0);
});

test("ADB stops after three stale handshake responses and reports the last packet", async () => {
  const h = adbHandshakeHarness(
    Array.from({ length: 3 }, () => ({ cmd: 0x45534c43, arg0: 7, arg1: 8 })),
  );
  await assert.rejects(
    h.device.connect(),
    /attempt 3\/3.*initial response.*CLSE.*arg0=7/,
  );
  assert.equal(h.events.filter((x) => x === "open").length, 2);
  assert.equal(h.device.isConnected, false);
  assert.equal(h.clock.timers.size, 0);
});

test("ADB never retries unknown packets or physical USB errors", async () => {
  for (const msg of [
    { cmd: 0x12345678, arg0: 0, arg1: 0 },
    new Error("USB disconnected"),
  ]) {
    const h = adbHandshakeHarness([msg]);
    await assert.rejects(h.device.connect(), /handshake failed/);
    assert.equal(h.events.includes("open"), false);
    assert.equal(h.clock.timers.size, 0);
  }
});

test("ADB handshake timeout closes pending reads before reopening", async () => {
  const h = adbHandshakeHarness([]);
  let rejectRead,
    reads = 0;
  h.device.readMsg = () =>
    ++reads === 1
      ? new Promise((_, reject) => {
          rejectRead = reject;
        })
      : Promise.resolve({ cmd: 0x4e584e43 });
  h.dev.close = async () => {
    h.events.push("canceled-read");
    rejectRead?.(new Error("closed"));
  };
  const connecting = h.device.connect();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.clock.timers.values().next().value.ms, 10000);
  await h.clock.tick();
  await connecting;
  assert.ok(h.events.indexOf("canceled-read") < h.events.indexOf("open"));
  assert.equal(h.device.isConnected, true);
});

test("ADB disconnect during handshake cancels retries and clears the timeout", async () => {
  const h = adbHandshakeHarness([]);
  let rejectRead;
  h.device.readMsg = () =>
    new Promise((_, reject) => {
      rejectRead = reject;
    });
  h.dev.close = async () => rejectRead?.(new Error("closed"));
  const connecting = h.device.connect();
  const canceled = assert.rejects(connecting, /canceled/);
  await new Promise((resolve) => setImmediate(resolve));
  await h.device.disconnect();
  await canceled;
  assert.equal(h.events.includes("open"), false);
  assert.equal(h.clock.timers.size, 0);
});

test("script upload normalizes CRLF, uses unique paths, and runs via persistent shell", async () => {
  const { DeviceSession } = moduleFrom("device-session.ts", {
    react: {},
    "./adb-webusb": {},
  });
  const session = new DeviceSession("adb");
  session.update("connected");
  const commands = [],
    writes = [];
  session.adb = {
    shell: async (command, receive) => {
      commands.push(command);
      receive("FAE_UPLOAD_OK");
    },
  };
  session.shell = {
    write: async (data) => writes.push(new TextDecoder().decode(data)),
  };
  await session.uploadScript({
    name: "test.sh",
    size: 10,
    text: async () => "echo 中\r\n",
  });
  assert.ok(commands[1].includes("\\012"));
  assert.ok(!commands[1].includes("\\015"));
  assert.match(writes[0], /^sh '\/data\/local\/tmp\/fae-[\w-]+\.sh'; rm -f/);
  await assert.rejects(
    () => session.uploadScript({ name: "test.vbs", size: 10 }),
    /\.sh/,
  );
});
