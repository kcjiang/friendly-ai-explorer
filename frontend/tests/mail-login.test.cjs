const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");

// Run the actual component's state transitions without a browser or mail server.
function mailboxWindow() {
  const slots = [];
  let cursor = 0;
  let poll;
  const overview = {
    mailboxes: [], folders: [], rules: [], unread: {}, unread_total: 0,
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next) => {
        slots[index] = typeof next === "function" ? next(slots[index]) : next;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback: (fn) => fn,
    useEffect: () => {},
  };
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  vm.runInNewContext(ts.transpileModule(
    fs.readFileSync("src/components/workbench/mail-window.tsx", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
  ).outputText, {
    exports,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (name === "@/hooks/use-polling") return { usePolling: (fn) => { poll = fn; } };
      if (name === "@/lib/api") return { default: { get: async () => ({ data: overview }) } };
      return new Proxy({}, { get: (_, key) => key });
    },
  });
  return {
    render() {
      cursor = 0;
      return exports.MailWindow({ open: true, onClose() {}, onChanged() {} });
    },
    refresh: () => poll(new AbortController().signal),
  };
}

function find(node, predicate) {
  if (!node || typeof node !== "object") return;
  if (predicate(node)) return node;
  for (const child of Array.isArray(node) ? node : Object.values(node)) {
    const found = find(child, predicate);
    if (found) return found;
  }
}

const loginDialog = (tree) => find(tree, (node) => node.props?.title === "登录邮箱");

test("empty mailbox refreshes never open or reopen the login dialog", async () => {
  const window = mailboxWindow();
  assert.equal(loginDialog(window.render()).props.open, false);
  await window.refresh();
  let tree = window.render();
  assert.equal(loginDialog(tree).props.open, false);
  find(tree, (node) => node.props?.children?.includes?.("登录邮箱")).props.onClick();
  tree = window.render();
  assert.equal(loginDialog(tree).props.open, true);
  loginDialog(tree).props.onClose();
  for (let i = 0; i < 3; i++) {
    await window.refresh();
    assert.equal(loginDialog(window.render()).props.open, false);
  }
});

test("mailbox polling preserves an in-progress login form", async () => {
  const window = mailboxWindow();
  let tree = window.render();
  find(tree, (node) => node.props?.children?.includes?.("登录邮箱")).props.onClick();
  tree = window.render();
  find(tree, (node) => node.props?.id === "mail-login-address")
    .props.onChange({ target: { value: "draft@example.test" } });
  for (let i = 0; i < 3; i++) {
    await window.refresh();
    tree = window.render();
    assert.equal(loginDialog(tree).props.open, true);
    assert.equal(find(tree, (node) => node.props?.id === "mail-login-address").props.value,
      "draft@example.test");
  }
});
