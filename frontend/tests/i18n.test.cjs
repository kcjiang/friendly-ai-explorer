const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { createTranslator } = require("next-intl");

function loadLocale() {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(path.join(__dirname, "../src/i18n/locale.ts"), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText,
    { exports },
  );
  return exports;
}

test("browser preference distinguishes Simplified and Traditional Chinese with English fallback", () => {
  const { browserLocale } = loadLocale();
  for (const tag of ["zh-CN", "zh-SG", "zh-Hans", "zh-Hans-CN"])
    assert.equal(browserLocale(tag), "zh-CN");
  for (const tag of [
    "zh-TW",
    "zh-HK",
    "zh-MO",
    "zh-Hant",
    "zh",
    "es",
    "vi",
    "en-GB",
    "",
  ])
    assert.equal(browserLocale(tag), "en");
  assert.equal(browserLocale("zh-TW,zh-CN;q=0.9"), "en");
  assert.equal(browserLocale("en;q=0.5,zh-CN;q=1"), "zh-CN");
  assert.equal(browserLocale("zh-CN;q=0,en"), "en");
});

test("all released languages have identical keys and valid ICU messages", () => {
  const base = require("../messages/en.json");
  for (const locale of ["en", "zh-CN"]) {
    const messages = require(`../messages/${locale}.json`);
    const errors = [];
    const t = createTranslator({
      locale,
      messages,
      onError: (e) => errors.push(e.message),
    });
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(base).sort());
    for (const section of Object.keys(base)) {
      assert.deepEqual(
        Object.keys(messages[section]).sort(),
        Object.keys(base[section]).sort(),
      );
      for (const key of Object.keys(base[section]))
        t(`${section}.${key}`, {
          p0: 2,
          p1: 3,
          p2: "test",
          p3: "test",
          message: "test",
          requestId: "test",
        });
    }
    assert.deepEqual(errors, []);
  }
});

test("backend durable message codes exist in the shared display catalog", () => {
  const messages = require("../messages/en.json");
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (file.endsWith(".py")) {
        const text = fs.readFileSync(file, "utf8");
        for (const match of text.matchAll(
          /system_message\(\s*"errors\.([A-Za-z0-9]+)"/g,
        ))
          assert.equal(
            typeof messages.errors[match[1]],
            "string",
            `${file}: ${match[1]}`,
          );
      }
    }
  }
  walk(path.join(__dirname, "../../backend/app"));
});

test("every statically referenced translation key exists in the English catalog", () => {
  const messages = require("../messages/en.json");
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.tsx?$/.test(file)) {
        const source = ts.createSourceFile(
          file,
          fs.readFileSync(file, "utf8"),
          99,
          true,
        );
        function visit(node) {
          if (
            ts.isCallExpression(node) &&
            node.expression.getText(source) === "t" &&
            ts.isStringLiteral(node.arguments[0] ?? {})
          ) {
            const key = node.arguments[0].text;
            assert.equal(
              typeof key.split(".").reduce((v, k) => v?.[k], messages),
              "string",
              `${file}: ${key}`,
            );
          }
          ts.forEachChild(node, visit);
        }
        visit(source);
      }
    }
  }
  walk(path.join(__dirname, "../src"));
});
