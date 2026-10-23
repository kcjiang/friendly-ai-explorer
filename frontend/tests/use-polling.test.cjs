const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");
const settle = () => new Promise(setImmediate);
const source = fs.readFileSync("src/hooks/use-polling.ts", "utf8");

function polling(callback, options = {}) {
  const timers = new Map();
  const document = { visibilityState: options.hidden ? "hidden" : "visible" };
  let cleanup,
    sequence = 0;
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      exports,
      document,
      AbortController,
      require: () => ({
        useRef: (current) => ({ current }),
        useEffect: (effect) => {
          cleanup = effect();
        },
      }),
      setTimeout: (fn) => {
        const id = ++sequence;
        timers.set(id, fn);
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  exports.usePolling(
    callback,
    1000,
    options.enabled ?? true,
    options.immediate ?? true,
    options.onError,
  );
  return {
    timers,
    document,
    close: () => cleanup?.(),
    next: async () => {
      const [id, fn] = timers.entries().next().value;
      timers.delete(id);
      await fn();
    },
  };
}

test("slow polling stays serial and aborting prevents rescheduling", async () => {
  let finish,
    calls = 0,
    signal;
  const poll = polling((current) => {
    calls++;
    signal = current;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  assert.equal(calls, 1);
  assert.equal(poll.timers.size, 0);
  finish();
  await settle();
  assert.equal(poll.timers.size, 1);
  const next = poll.next();
  assert.equal(calls, 2);
  poll.close();
  assert.equal(signal.aborted, true);
  finish();
  await next;
  assert.equal(poll.timers.size, 0);
});

test("background tabs skip requests and resume on a visible tick", async () => {
  let calls = 0;
  const poll = polling(
    async () => {
      calls++;
    },
    { hidden: true },
  );
  assert.equal(calls, 0);
  poll.document.visibilityState = "visible";
  await poll.next();
  assert.equal(calls, 1);
  poll.close();
});

test("request failures report errors and keep polling", async () => {
  let calls = 0;
  const errors = [];
  const poll = polling(
    async () => {
      calls++;
      throw new Error("unavailable");
    },
    { onError: (e) => errors.push(e.message) },
  );
  await settle();
  assert.deepEqual(errors, ["unavailable"]);
  await poll.next();
  assert.equal(calls, 2);
  poll.close();
  assert.equal(poll.timers.size, 0);
});

test("disabled polling makes no request and delayed polling waits for its tick", async () => {
  let calls = 0;
  const disabled = polling(
    async () => {
      calls++;
    },
    { enabled: false },
  );
  assert.equal(calls, 0);
  assert.equal(disabled.timers.size, 0);
  const delayed = polling(
    async () => {
      calls++;
    },
    { immediate: false },
  );
  assert.equal(calls, 0);
  await delayed.next();
  assert.equal(calls, 1);
  delayed.close();
});
