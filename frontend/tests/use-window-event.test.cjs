const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function eventHook() {
  const slots = [];
  const effects = [];
  const listeners = new Map();
  let cursor = 0;
  const exports = {};
  const react = {
    useRef(value) {
      const index = cursor++;
      return (slots[index] ??= { current: value });
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        effects.push(() => {
          previous?.cleanup?.();
          slots[index] = { deps, cleanup: effect() };
        });
      }
    },
  };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(
        path.join(__dirname, "../src/hooks/use-window-event.ts"),
        "utf8",
      ),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText,
    {
      exports,
      require: () => react,
      window: {
        addEventListener(type, handler) {
          assert.equal(listeners.has(type), false, "duplicate subscription");
          listeners.set(type, handler);
        },
        removeEventListener(type, handler) {
          assert.equal(listeners.get(type), handler);
          listeners.delete(type);
        },
      },
    },
  );
  return {
    listeners,
    render(type, handler) {
      cursor = 0;
      exports.useWindowEvent(type, handler);
      effects.splice(0).forEach((effect) => effect());
    },
    unmount() {
      slots.forEach((slot) => slot.cleanup?.());
    },
  };
}

test("device commands use the latest render state without duplicate listeners", () => {
  const hook = eventHook();
  const calls = [];
  hook.render("command", () => calls.push("old device"));
  const subscription = hook.listeners.get("command");
  hook.render("command", () => calls.push("current device"));
  assert.equal(hook.listeners.get("command"), subscription);
  subscription({});
  assert.deepEqual(calls, ["current device"]);
  hook.unmount();
  assert.equal(hook.listeners.size, 0);
});

test("changing the event name removes the previous subscription", () => {
  const hook = eventHook();
  hook.render("adb", () => {});
  hook.render("serial", () => {});
  assert.deepEqual([...hook.listeners.keys()], ["serial"]);
  hook.unmount();
  assert.equal(hook.listeners.size, 0);
});
