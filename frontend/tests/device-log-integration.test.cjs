const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const jsx = (type, props, key) => ({ type, props, key });
function load(file, mocks) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(path.join(__dirname, "../src", file), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2020,
        },
      },
    ).outputText,
    {
      exports,
      require: (name) =>
        name === "react/jsx-runtime"
          ? { jsx, jsxs: jsx, Fragment: "fragment" }
          : mocks[name] ||
            (name === "@/lib/device-log-name"
              ? load("lib/device-log-name.ts", {})
              : {}),
      crypto: require("node:crypto").webcrypto,
      File,
      Blob,
      AbortController,
      setTimeout,
      clearTimeout,
      URL,
    },
  );
  return exports;
}
const pause = () => new Promise((resolve) => setImmediate(resolve));
function uploadsHarness() {
  const calls = [],
    notices = [];
  const taskModule = load("lib/log-upload-task.ts", {});
  const uploads = load("components/debug/device-log-upload.tsx", {
    "@/components/ui/base/toast": {
      createToastManager: () => ({
        add: (notice) => {
          const id = String(notices.length);
          notices.push({ id, notice });
          return id;
        },
        update: (id, notice) => notices.push({ id, notice }),
      }),
    },
    "@/lib/log-upload-task": taskModule,
    "@/lib/upload-manager": {
      uploadManager: {
        enqueue: (file, metadata, options) => {
          let resolve, reject;
          const promise = new Promise((ok, fail) => {
            resolve = ok;
            reject = fail;
          });
          options.signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          );
          calls.push({
            file,
            metadata,
            ...options,
            finish: () => resolve({ filename: "saved-" + file.name }),
          });
          return { promise };
        },
      },
    },
    react: { useSyncExternalStore: (_, snapshot) => snapshot() },
  });
  const controls = load("components/debug/device-log-controls.tsx", {
    "./device-log-upload": uploads,
    "next/dynamic": { default: () => "History" },
    "next/navigation": { usePathname: () => "/terminal" },
    "next-intl": { useLocale: () => "zh-CN" },
    "@/components/ui/base/button": { Button: "button" },
  });
  const button = (session) => {
    const wrapper = controls.DeviceLogUploadButton({ session });
    return wrapper.type(wrapper.props);
  };
  return { ...uploads, controls, calls, notices, button };
}

test("upload button captures the current transcript at click time and tags its actual transport", async () => {
  const h = uploadsHarness();
  const session = { kind: "adb", transcript: "old snapshot" };
  const button = h.button(session);
  session.transcript = "latest 中文 output\n";
  button.props.onClick();
  session.transcript = "arrived after click";
  assert.equal(h.calls.length, 1);
  assert.equal(await h.calls[0].file.text(), "latest 中文 output\n");
  assert.equal(h.calls[0].file.type, "text/plain;charset=utf-8");
  assert.match(h.calls[0].file.name, /^adb_\d{8}_\d{6}_[0-9a-f]{4}\.log$/);
  assert.equal(h.calls[0].metadata.device_type, "adb");
  assert.equal(h.calls[0].metadata.purpose, "log");
  h.calls[0].finish();
  await pause();
  assert.equal(h.deviceLogUploads.adb.getSnapshot().phase, "success");
  assert.equal(h.deviceLogUploads.adb.getSnapshot().revision, 1);
  assert.equal(h.deviceLogUploads.serial.getSnapshot().revision, 0);
});

test("terminal and console share serial upload state while ADB has independent progress and cancellation", async () => {
  const h = uploadsHarness();
  const serial = { kind: "serial", transcript: "serial log" };
  h.button(serial).props.onClick();
  const otherPage = h.button(serial);
  assert.equal(otherPage.props["aria-label"], "查看上传进度");
  otherPage.props.onClick();
  assert.equal(
    h.calls.length,
    1,
    "reopening progress must not queue another serial upload",
  );
  h.button({ kind: "adb", transcript: "ADB log" }).props.onClick();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].metadata.device_type, "serial");
  assert.match(h.calls[0].file.name, /^serial_/);
  h.calls[0].progress(37);
  h.calls[1].progress(75);
  assert.equal(h.deviceLogUploads.serial.getSnapshot().progress, 37);
  assert.equal(h.deviceLogUploads.adb.getSnapshot().progress, 75);
  h.deviceLogUploads.serial.cancel();
  await pause();
  assert.equal(h.calls[0].signal.aborted, true);
  assert.equal(h.calls[1].signal.aborted, false);
  assert.equal(h.deviceLogUploads.serial.getSnapshot().phase, "cancelled");
  assert.equal(h.deviceLogUploads.adb.getSnapshot().phase, "uploading");
  h.calls[1].finish();
  await pause();
  assert.equal(h.deviceLogUploads.adb.getSnapshot().phase, "success");
  assert.ok(h.notices.some((n) => n.notice.data.deviceType === "adb"));
  assert.ok(h.notices.some((n) => n.notice.data.deviceType === "serial"));
});

test("empty uploads do not make requests and the binary remote port has no upload action", () => {
  const h = uploadsHarness();
  h.button({ kind: "serial", transcript: " \r\n" }).props.onClick();
  assert.equal(h.calls.length, 0);
  assert.equal(h.deviceLogUploads.serial.getSnapshot().phase, "empty");
  assert.equal(
    h.controls.DeviceLogUploadButton({ session: { kind: "remote" } }),
    null,
  );
});

function historyHarness(deviceType) {
  const effects = [],
    requests = [],
    updates = [],
    kinds = [];
  let stateId = 0,
    finish;
  const api = {
    get: (url, options) => {
      requests.push({ url, options });
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
  const table = {
    getHeaderGroups: () => [],
    getRowModel: () => ({ rows: [] }),
    getPageCount: () => 1,
    getCanPreviousPage: () => false,
    getCanNextPage: () => false,
  };
  const component = load("components/debug/device-log-history.tsx", {
    react: {
      useState: (initial) => {
        const id = stateId++;
        return [initial, (value) => updates.push({ id, value })];
      },
      useCallback: (fn) => fn,
      useMemo: (fn) => fn(),
      useEffect: (fn) => effects.push(fn),
    },
    "next-intl": { useLocale: () => "zh-CN" },
    "@tanstack/react-table": {
      tableFeatures: () => ({}),
      useTable: () => table,
    },
    "@/lib/api": { default: api },
    "./device-log-upload": {
      useDeviceLogHistoryRevision: () => {
        kinds.push("adb", "serial");
        return "0:0";
      },
    },
  });
  component.default({ open: true, onClose: () => {}, deviceType });
  const cleanups = effects.map((fn) => fn());
  return {
    requests,
    updates,
    kinds,
    finish: () =>
      finish({
        data: { items: [{ id: "log", filename: "example.txt" }], total: 1 },
      }),
    close: () => cleanups.forEach((fn) => fn?.()),
  };
}

test("shared history requests mixed paginated logs and cancels stale responses", async () => {
  for (const kind of ["adb", "serial"]) {
    const h = historyHarness(kind);
    assert.equal(h.requests.length, 1);
    const { url, options } = h.requests[0];
    assert.equal(url, "/api/v1/debug/logs");
    assert.equal(options.params.device_type, undefined);
    assert.equal(options.params.page, 1);
    assert.equal(options.params.page_size, 10);
    assert.equal(options.params.q, "");
    assert.deepEqual(h.kinds, ["adb", "serial"]);
    h.close();
    assert.equal(options.signal.aborted, true);
    h.finish();
    await pause();
    assert.equal(
      h.updates.some((update) => update.id === 0),
      false,
      "a closed history must not accept stale rows",
    );
  }
});
