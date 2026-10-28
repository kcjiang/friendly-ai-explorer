const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
function load(file, modules = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(path.join(__dirname, "../src/lib", file), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
        },
      },
    ).outputText,
    {
      exports,
      require: (name) => modules[name],
      Uint8Array,
      setTimeout,
      clearTimeout,
    },
  );
  return exports;
}
const keys = load("remote-keys.ts");
const { createRemotePressController } = load("remote-press.ts", {
  "./remote-keys": keys,
});
const flush = async () => {
  for (let n = 0; n < 5; n++) await Promise.resolve();
};
function setup(send) {
  let connected = true,
    serial = 0;
  const jobs = new Map(),
    writes = [],
    feedback = [],
    errors = [],
    sent = [];
  const clock = {
    setTimeout(fn, delay) {
      const id = ++serial;
      jobs.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) {
      jobs.delete(id);
    },
  };
  const controller = createRemotePressController(
    {
      isConnected: () => connected,
      send: (bytes, onTransmit) => {
        writes.push(Array.from(bytes));
        if (send) return send(onTransmit, writes.length);
        onTransmit();
        return Promise.resolve();
      },
      feedback: (value) => feedback.push(value),
      sent: (id) => sent.push(id),
      error: (error) => errors.push(error),
    },
    clock,
  );
  return {
    controller,
    jobs,
    writes,
    feedback,
    errors,
    sent,
    disconnect() {
      connected = false;
    },
    async tick(delay) {
      const next = jobs.entries().next().value;
      assert.ok(next, "expected scheduled repeat");
      assert.equal(next[1].delay, delay);
      jobs.delete(next[0]);
      next[1].fn();
      await flush();
    },
  };
}

test("red feedback waits for the actual serial write callback, not press or release", async () => {
  let notify, complete;
  const h = setup((onTransmit) => {
    notify = onTransmit;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  h.controller.start("ok");
  assert.deepEqual(h.feedback, []);
  h.controller.stop();
  notify();
  assert.deepEqual(h.feedback, ["send"]);
  complete();
  await flush();
  assert.equal(h.writes.length, 1);
  assert.equal(h.jobs.size, 0);
});

test("only the six direction/volume keys repeat, and release cancels further repeats", async () => {
  for (const id of ["up", "down", "left", "right", "volumeUp", "volumeDown"]) {
    const h = setup();
    h.controller.start(id);
    await flush();
    await h.tick(450);
    await h.tick(180);
    assert.equal(h.writes.length, 3, id);
    assert.deepEqual(h.feedback, ["send", "send", "send"]);
    h.controller.stop();
    assert.equal(h.jobs.size, 0);
  }
  for (const id of ["ok", "home", "back", "settings"]) {
    const h = setup();
    h.controller.start(id);
    await flush();
    assert.equal(h.writes.length, 1, id);
    assert.equal(h.jobs.size, 0, id);
  }
});

test("slow serial writes never accumulate a repeat backlog after release", async () => {
  let complete;
  const h = setup((onTransmit, count) => {
    onTransmit();
    return count === 2
      ? new Promise((resolve) => {
          complete = resolve;
        })
      : Promise.resolve();
  });
  h.controller.start("volumeUp");
  await flush();
  await h.tick(450);
  assert.equal(h.jobs.size, 0);
  assert.equal(h.writes.length, 2);
  h.controller.stop();
  complete();
  await flush();
  assert.equal(h.jobs.size, 0);
  assert.equal(h.writes.length, 2);
});

test("disconnected presses warn once without writing or scheduling repeats", async () => {
  const h = setup();
  h.disconnect();
  h.controller.start("up");
  await flush();
  assert.deepEqual(h.feedback, ["disconnected"]);
  assert.equal(h.writes.length, 0);
  assert.equal(h.jobs.size, 0);
  h.controller.start("power");
  h.controller.start("unknown");
  assert.deepEqual(h.feedback, ["disconnected"]);
});

test("disconnect and failed writes stop a held key without a false red pulse", async () => {
  const h = setup();
  h.controller.start("up");
  await flush();
  h.disconnect();
  await h.tick(450);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.feedback, ["send", "disconnected"]);
  assert.equal(h.jobs.size, 0);
  const failure = new Error("serial unplugged");
  const f = setup(() => Promise.reject(failure));
  f.controller.start("up");
  await flush();
  assert.deepEqual(f.feedback, ["error"]);
  assert.deepEqual(f.errors, [failure]);
  assert.equal(f.jobs.size, 0);
});

test("disposing a controller suppresses delayed feedback and future repeats", async () => {
  let notify, complete;
  const h = setup((onTransmit) => {
    notify = onTransmit;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  h.controller.start("up");
  h.controller.dispose();
  notify();
  complete();
  await flush();
  h.controller.start("up");
  assert.deepEqual(h.feedback, []);
  assert.deepEqual(h.sent, []);
  assert.equal(h.jobs.size, 0);
  assert.equal(h.writes.length, 1);
});
