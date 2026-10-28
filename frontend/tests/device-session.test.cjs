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
      require: (name) => mocks[name],
      TextDecoder,
      TextEncoder,
      Uint8Array,
      DataView,
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
