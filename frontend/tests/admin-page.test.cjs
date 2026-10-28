const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");

function component(name, props = {}, failLoad = false) {
  const slots = [],
    effects = [],
    requests = [];
  let cursor = 0,
    tree;
  const translate = (key) => key;
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [
        slots[i],
        (value) => {
          slots[i] = typeof value === "function" ? value(slots[i]) : value;
        },
      ];
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!slots[i] || deps.some((v, j) => v !== slots[i].deps[j]))
        slots[i] = { fn, deps };
      return slots[i].fn;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || deps.some((v, j) => v !== slots[i][j])) effects.push(fn);
      slots[i] = deps;
    },
  };
  const users = Array.from({ length: 25 }, (_, i) => ({
    id: String(i),
    name: `Person ${i}`,
    email: `person${i}@example.com`,
    role: i % 2 ? "engineer" : "developer",
    is_active: true,
    created_at: "2026-01-01",
  }));
  const api = {
    get: async () => {
      if (failLoad) throw new Error("Load failed");
      return { data: users };
    },
    patch: async (...args) => {
      requests.push(args);
      return { data: {} };
    },
    post: async (...args) => {
      requests.push(args);
      return { data: {} };
    },
  };
  const helper = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("src/lib/admin-request.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    { exports: helper.exports, URL },
  );
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync("src/app/(app)/admin/page.tsx", "utf8") +
        "\nexport { UsersTab, UserFormModal, ApiTesterTab };",
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText,
    {
      exports,
      URL,
      window: { location: { origin: "https://example.com" } },
      fetch: async (...args) => {
        requests.push(args);
        return {
          status: 200,
          headers: { get: () => "application/json" },
          text: async () => '{"ok":true}',
        };
      },
      require(module) {
        if (module === "react") return react;
        if (module === "react/jsx-runtime") return { jsx, jsxs: jsx };
        if (module === "next-auth/react")
          return {
            useSession: () => ({
              data: { accessToken: "test-token", user: { role: "developer" } },
            }),
          };
        if (module === "next-intl") return { useLocale: () => "en" };
        if (module === "@/i18n/client")
          return {
            useUiTranslations: () => translate,
            translateLabels: (value) => value,
          };
        if (module === "@/lib/admin-request") return helper.exports;
        if (module === "@/lib/api") return { default: api };
        if (module === "@/lib/errors")
          return { errorMessage: (error) => error.message };
        if (module.endsWith("unsaved-changes"))
          return {
            useAdminChanges() {},
            useAdminLeave: () => async () => true,
          };
        if (module.endsWith("feedback-provider"))
          return { useFeedback: () => ({ confirm: async () => true }) };
        return new Proxy({}, { get: (_obj, key) => key });
      },
    },
  );
  function nodes(value) {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap(nodes);
    return [value, ...nodes(value.props?.children)];
  }
  function text(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(text).join("");
    return value?.props ? text(value.props.children) : "";
  }
  function render() {
    cursor = 0;
    tree = exports[name](props);
    while (effects.length) effects.shift()();
  }
  const all = () => nodes(tree);
  const field = (label) =>
    all().find((node) => node.props?.["aria-label"] === label);
  const button = (label) =>
    all().find((node) => node.type === "Button" && text(node) === label);
  async function settle() {
    await new Promise(setImmediate);
    render();
  }
  render();
  return {
    render,
    all,
    field,
    button,
    settle,
    requests,
    helper: helper.exports,
  };
}

test("API tester rejects off-site, credential-bearing and non-API URLs before fetch", async () => {
  for (const url of [
    "https://evil.example/api/v1/users",
    "//evil.example/api/v1/users",
    "https://admin:secret@example.com/api/v1/users",
    "/api/v1/../../login",
    "javascript:alert(1)",
  ]) {
    const view = component("ApiTesterTab");
    view.field("API URL").props.onChange({ target: { value: url } });
    view.render();
    await view.button("ui.send").props.onClick();
    assert.equal(view.requests.length, 0, url);
  }
});

test("API tester authenticates only local API requests and rejects redirects", async () => {
  const view = component("ApiTesterTab");
  await view.button("ui.send").props.onClick();
  assert.equal(view.requests[0][0], "https://example.com/api/v1/admin/users");
  assert.equal(view.requests[0][1].redirect, "error");
  assert.equal(view.requests[0][1].headers.Authorization, "Bearer test-token");
});

test("invalid replacement password prevents all user update requests", async () => {
  const view = component("UserFormModal", {
    mode: "edit",
    user: {
      id: "one",
      name: "Original",
      role: "engineer",
      email: "one@example.com",
    },
    onClose() {},
    onSuccess() {},
  });
  view.field("ui.name").props.onChange({ target: { value: "Changed" } });
  view.render();
  view
    .field("ui.resetPasswordLeaveBlankToKeepCurrent")
    .props.onChange({ target: { value: "123" } });
  view.render();
  await view.button("ui.save").props.onClick();
  assert.equal(view.requests.length, 0);
});

test("user list paginates the complete result and filters before pagination", async () => {
  const view = component("UsersTab");
  await view.settle();
  const rows = () =>
    view
      .all()
      .filter(
        (node) =>
          node.type === "TableRow" &&
          node.props.children?.[0]?.type === "TableCell",
      );
  assert.equal(rows().length, 20);
  view.button("ui.next").props.onClick();
  view.render();
  assert.equal(rows().length, 5);
  view.field("Search users").props.onChange({ target: { value: "person24@" } });
  view.render();
  assert.equal(rows().length, 1);
  view.field("ui.role").props.onChange({ target: { value: "engineer" } });
  view.render();
  assert.equal(rows().length, 0);
});

test("user loading failures are visible and offer retry", async () => {
  const view = component("UsersTab", {}, true);
  await view.settle();
  assert.ok(view.all().some((node) => node.props?.role === "alert"));
  assert.ok(view.button("Reload"));
});
