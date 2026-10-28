const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const exportsForTest = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/lib/remote-keys.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  { exports: exportsForTest, Uint8Array },
);

test("the ten supported remote keys keep the original verified serial commands", () => {
  const expected = {
    up: 0x00,
    down: 0x01,
    left: 0x03,
    right: 0x02,
    ok: 0x1f,
    home: 0x0c,
    back: 0x1c,
    volumeUp: 0x58,
    volumeDown: 0x5d,
    settings: 0x0a,
  };
  assert.equal(
    exportsForTest.remoteKeys.filter((key) => "code" in key).length,
    10,
  );
  for (const [id, code] of Object.entries(expected))
    assert.deepEqual(Array.from(exportsForTest.remoteCommand(id)), [
      0xfa,
      0xf1,
      0x08,
      0xf7,
      code,
    ]);
});

test("unsupported controls and unknown identifiers never produce serial commands", () => {
  for (const id of [
    "power",
    "input",
    "profile",
    "voice",
    "tv",
    "channelUp",
    "channelDown",
    "liveTv",
    "red",
    "blue",
    "yellow",
    "green",
    "youtube",
    "netflix",
    "prime",
    "music",
    "unknown",
    "",
    "toString",
  ])
    assert.equal(exportsForTest.remoteCommand(id), null, id);
});
