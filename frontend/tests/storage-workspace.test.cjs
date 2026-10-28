const { test } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const fs = require("node:fs");
const vm = require("node:vm");

function workspace(saved = "215", storageAvailable = true) {
  const slots = [],
    effects = [],
    writes = [];
  let pageTop = 0,
    toolbarBottom = 112;
  const toolbar = {};
  const page = {
    getBoundingClientRect: () => ({ top: pageTop }),
    querySelector: () => toolbar,
  };
  const host = {
    clientWidth: 1000,
    getBoundingClientRect: () => ({ top: toolbarBottom + pageTop }),
    closest: () => page,
  };
  let cursor = 0,
    tree,
    observe;
  const react = {
    useRef(initial) {
      const i = cursor++;
      return (slots[i] ??= { current: initial === null ? host : initial });
    },
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [
        slots[i],
        (next) => {
          slots[i] = typeof next === "function" ? next(slots[i]) : next;
        },
      ];
    },
    useLayoutEffect(fn) {
      const i = cursor++;
      if (!slots[i]) {
        slots[i] = true;
        effects.push(fn);
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync("src/components/files/storage-workspace.tsx", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText,
    {
      exports,
      window: {
        innerHeight: 900,
        addEventListener() {},
        removeEventListener() {},
      },
      localStorage: {
        getItem: () => {
          if (!storageAvailable) throw Error("Unavailable");
          return saved;
        },
        setItem: (_key, value) => {
          if (!storageAvailable) throw Error("Unavailable");
          writes.push(value);
        },
      },
      ResizeObserver: class {
        constructor(fn) {
          observe = fn;
        }
        observe() {}
        disconnect() {}
      },
      require(name) {
        if (name === "react") return react;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        return new Proxy({}, { get: (_obj, key) => key });
      },
    },
  );
  function render(runEffects = true) {
    cursor = 0;
    tree = exports.default({
      navigation: "navigation",
      mobileNavigation: "mobile",
      children: "files",
      resizeLabel: "Resize",
    });
    if (runEffects) while (effects.length) effects.shift()();
  }
  function nodes(value) {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap(nodes);
    return [value, ...nodes(value.props?.children)];
  }
  function panel() {
    return nodes(tree).find((n) => n.props?.id === "storage-navigation");
  }
  render(false);
  const initial = tree;
  render();
  render();
  return {
    initial,
    group: () =>
      nodes(tree).find((node) => node.type === "ResizablePanelGroup"),
    changeToolbar(top) {
      toolbarBottom = top;
      observe();
      render();
    },
    scrollPage(top) {
      pageTop = top;
      observe();
      render();
    },
    render,
    panel,
    writes,
    resizeHost(width) {
      host.clientWidth = width;
      observe();
      render();
    },
  };
}

test("initial render reserves space without mounting a temporary single-column file list", () => {
  const view = workspace();
  const text = JSON.stringify(view.initial);
  assert.equal(text.includes('"files"'), false);
  assert.equal(text.includes('"mobile"'), false);
  assert.ok(text.includes('"aria-busy":"true"'));
});

test("workspace height follows toolbar wrapping and remains stable when the page scrolls", () => {
  const view = workspace();
  assert.equal(view.group().props.style.height, 764);
  view.changeToolbar(160);
  assert.equal(view.group().props.style.height, 716);
  view.scrollPage(-200);
  assert.equal(view.group().props.style.height, 716);
});

test("navigation width is restored and the dragged width survives compact layout changes", () => {
  const view = workspace();
  assert.equal(view.panel().props.defaultSize, 215);
  view
    .panel()
    .props.onResize({ inPixels: 230 }, "storage-navigation", { inPixels: 215 });
  view.render();
  assert.equal(view.writes.at(-1), "230");
  view.resizeHost(400);
  assert.equal(view.panel(), undefined);
  view.resizeHost(1000);
  assert.equal(view.panel().props.defaultSize, 230);
});

test("invalid preferences and unavailable storage do not prevent resizing", () => {
  for (const view of [
    workspace("NaN"),
    workspace("999"),
    workspace(null, false),
  ]) {
    assert.equal(view.panel().props.defaultSize, 192);
    view.panel().props.onResize({ inPixels: 205 }, "storage-navigation", {
      inPixels: 192,
    });
    view.render();
    assert.equal(view.panel().props.defaultSize, 205);
  }
});

test("narrow navigation widths are restored and clamped to the new minimum", () => {
  const view = workspace("88");
  assert.equal(view.panel().props.defaultSize, 88);
  assert.equal(view.panel().props.minSize, 88);
  view
    .panel()
    .props.onResize({ inPixels: 50 }, "storage-navigation", { inPixels: 88 });
  view.render();
  assert.equal(view.writes.at(-1), "88");
  view.resizeHost(500);
  assert.ok(view.panel());
  view.resizeHost(400);
  assert.equal(view.panel(), undefined);
});
