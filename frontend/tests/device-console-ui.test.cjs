const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

test("device console has no stray patch markers rendered as JSX text", () => {
  for (const name of ["device-console.tsx", "device-media-stage.tsx"]) {
    const source = ts.createSourceFile(
      name,
      fs.readFileSync(
        path.join(__dirname, "../src/components/debug", name),
        "utf8",
      ),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const markers = [];
    function visit(node) {
      if (ts.isJsxText(node) && /^\s*\+\s*$/.test(node.text))
        markers.push(source.getLineAndCharacterOfPosition(node.pos).line + 1);
      ts.forEachChild(node, visit);
    }
    visit(source);
    assert.deepEqual(markers, [], `${name}: stray + at ${markers.join(", ")}`);
  }
});
