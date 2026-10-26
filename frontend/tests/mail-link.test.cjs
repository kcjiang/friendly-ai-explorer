const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");
const exportsObject = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync("src/lib/mail-link.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  { exports: exportsObject, URL },
);
const { normalizeMailLink } = exportsObject;
test("links normalize HTTPS, explicit HTTP and mailto addresses", () => {
  assert.equal(
    normalizeMailLink(" example.com/docs "),
    "https://example.com/docs",
  );
  assert.equal(normalizeMailLink("http://example.com"), "http://example.com/");
  assert.equal(
    normalizeMailLink("mailto:fae@example.com"),
    "mailto:fae@example.com",
  );
});
test("unsafe, credential-bearing and incomplete links are rejected", () => {
  for (const input of [
    "",
    "https://",
    "javascript:alert(1)",
    "data:text/html,bad",
    "file:///tmp/test",
    "https://user:secret@example.com",
    "mailto:",
    "https://example.com\nInjected",
  ])
    assert.equal(normalizeMailLink(input), null, input);
});
