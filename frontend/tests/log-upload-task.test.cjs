const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const exportsForTest = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, "../src/lib/log-upload-task.ts"),
      "utf8",
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  { exports: exportsForTest, AbortController, Set, Math },
);
function setup() {
  let resolve, reject, progress, signal;
  const adds = [],
    updates = [];
  const task = exportsForTest.createLogUploadTask({
    upload: (text, abortSignal, report) => {
      signal = abortSignal;
      progress = report;
      return new Promise((ok, fail) => {
        resolve = ok;
        reject = fail;
        signal.addEventListener("abort", () => fail(new Error("cancelled")), {
          once: true,
        });
      });
    },
    notices: {
      add: (notice) => {
        const id = `toast-${adds.length + 1}`;
        adds.push({ id, notice });
        return id;
      },
      update: (id, notice) => updates.push({ id, notice }),
    },
  });
  return {
    task,
    adds,
    updates,
    progress: (value) => progress(value),
    finish: () => resolve({ filename: "serial_saved.txt" }),
    fail: () => reject(new Error("offline")),
    signal: () => signal,
  };
}

test("visible upload progress and success stay in the same toast", async () => {
  const h = setup();
  const promise = h.task.start("log snapshot\n");
  h.progress(35);
  h.progress(100);
  assert.equal(h.task.getSnapshot().phase, "uploading");
  assert.equal(h.adds.length, 1);
  h.finish();
  await promise;
  assert.equal(h.adds.length, 1);
  assert.equal(h.updates.at(-1).id, h.adds[0].id);
  assert.equal(h.updates.at(-1).notice.phase, "success");
  assert.equal(h.task.getSnapshot().revision, 1);
});

test("visible failures update the progress toast instead of adding another", async () => {
  const h = setup();
  const promise = h.task.start("log");
  h.fail();
  await promise;
  assert.equal(h.adds.length, 1);
  assert.equal(h.updates.at(-1).id, h.adds[0].id);
  assert.equal(h.updates.at(-1).notice.phase, "error");
});

test("closing progress neither aborts nor recreates it until a new result toast", async () => {
  const h = setup();
  const promise = h.task.start("log");
  h.adds[0].notice.onClose();
  h.progress(45);
  h.progress(100);
  assert.equal(h.signal().aborted, false);
  assert.equal(h.adds.length, 1);
  assert.equal(h.updates.length, 0);
  h.finish();
  await promise;
  assert.equal(h.adds.length, 2);
  assert.equal(h.adds[1].notice.phase, "success");
  assert.notEqual(h.adds[0].id, h.adds[1].id);
});

test("reopening progress doesn't duplicate uploads and ignores old close callbacks", async () => {
  const h = setup();
  const promise = h.task.start("log");
  h.adds[0].notice.onClose();
  await h.task.start("ignored new snapshot");
  assert.equal(h.adds.length, 2);
  h.adds[0].notice.onClose();
  h.progress(70);
  h.finish();
  await promise;
  assert.equal(h.adds.length, 2);
  assert.equal(h.updates.at(-1).id, h.adds[1].id);
  assert.equal(h.updates.at(-1).notice.phase, "success");
});

test("only Cancel aborts the request and changes the visible toast to cancelled", async () => {
  const h = setup();
  const promise = h.task.start("log");
  h.adds[0].notice.cancel();
  await promise;
  assert.equal(h.signal().aborted, true);
  assert.equal(h.adds.length, 1);
  assert.equal(h.updates.at(-1).notice.phase, "cancelled");
  assert.equal(h.task.getSnapshot().revision, 0);
});

test("empty logs don't create a request", async () => {
  const h = setup();
  await h.task.start(" \n\t");
  assert.equal(h.signal(), undefined);
  assert.equal(h.adds[0].notice.phase, "empty");
});
