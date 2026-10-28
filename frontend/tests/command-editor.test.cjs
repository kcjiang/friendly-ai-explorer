const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");

function editor() {
  const slots = [],
    effects = [];
  let cursor = 0;
  const command = (id, name) => ({
    id,
    name,
    command: "help",
    group: "General",
    confirmBeforeRun: false,
  });
  let latest = [command("one", "Original")];
  let revision = "initial",
    saved;
  let loseResponse = false,
    requestCount = 0,
    nextId = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (value) => {
          slots[index] =
            typeof value === "function" ? value(slots[index]) : value;
        },
      ];
    },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => value !== slots[index][i]))
        effects.push(fn);
      slots[index] = deps;
    },
  };
  const api = {
    get: async () => ({
      data: {
        catalog: { commands: latest },
        revision,
        exists: true,
        path: "server/default.json",
      },
    }),
    put: async (_url, body) => {
      if (body.revision !== revision)
        throw { axios: true, response: { status: 409 }, message: "Conflict" };
      requestCount++;
      saved = body;
      latest = body.catalog.commands;
      revision = `saved-${requestCount}`;
      if (loseResponse) {
        loseResponse = false;
        throw { axios: true, message: "Response lost" };
      }
      return { data: { revision } };
    },
  };
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync("src/components/debug/quick-commands.tsx", "utf8") +
        "\nexport { CommandList };",
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText,
    {
      exports,
      console,
      crypto: { randomUUID: () => `new-id-${++nextId}` },
      confirm: () => true,
      localStorage: { getItem: () => null, setItem() {} },
      require(name) {
        if (name === "react") return react;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        if (name === "next-auth/react")
          return {
            useSession: () => ({
              data: { user: { id: "me", role: "engineer" } },
            }),
          };
        if (name === "axios") return { isAxiosError: (value) => !!value.axios };
        if (name === "@/lib/api") return { default: api };
        if (name === "@/lib/errors")
          return { errorMessage: (value) => value.message };
        if (name === "./device-tools")
          return { useDeviceText: () => (en) => en };
        return { Button: "Button", Input: "Input", Textarea: "Textarea" };
      },
    },
  );
  const onLockChange = () => {};
  let tree;
  function render() {
    cursor = 0;
    tree = exports.CommandList({
      deviceType: "adb",
      space: "personal",
      disabled: false,
      onRun() {},
      onLockChange,
    });
    while (effects.length) effects.shift()();
    return tree;
  }
  function nodes(value) {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap(nodes);
    return [value, ...nodes(value.props?.children)];
  }
  const button = (label) =>
    nodes(tree).find(
      (node) => node.type === "Button" && node.props.children === label,
    );
  const field = (label) =>
    nodes(tree).find((node) => node.props?.["aria-label"] === label);
  const settle = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    render();
  };
  return {
    render,
    settle,
    button,
    field,
    nodes: () => nodes(tree),
    submit: () =>
      nodes(tree)
        .find((node) => node.type === "form")
        .props.onSubmit({ preventDefault() {} }),
    changeRemote(changed = false) {
      latest = [
        command("one", changed ? "Remote change" : "Original"),
        command("two", "Other person's command"),
      ];
      revision = "remote";
    },
    saved: () => saved,
    loseNextResponse: () => {
      loseResponse = true;
    },
    requestCount: () => requestCount,
    latest: () => latest,
    deleteRemote() {
      latest = [];
      revision = "deleted";
    },
  };
}

test("editing locks list actions and a conflict preserves the draft plus unrelated remote commands", async () => {
  const view = editor();
  view.render();
  await view.settle();
  view.button("Edit").props.onClick();
  view.render();
  assert.equal(view.button("New").props.disabled, true);
  assert.equal(view.button("Edit").props.disabled, true);
  assert.equal(view.button("Delete").props.disabled, true);
  assert.equal(view.field("Name").props.maxLength, 200);
  view.field("Name").props.onChange({ target: { value: "My draft" } });
  view.render();
  view.changeRemote();
  await view.submit();
  view.render();
  assert.equal(view.field("Name").props.value, "My draft");
  view.button("Reload latest and keep draft").props.onClick();
  await view.settle();
  await view.submit();
  view.render();
  assert.deepEqual(
    Array.from(view.saved().catalog.commands, (item) => item.name),
    ["My draft", "Other person's command"],
  );
});

test("a concurrent change to the edited command requires explicit comparison before saving", async () => {
  const view = editor();
  view.render();
  await view.settle();
  view.button("Edit").props.onClick();
  view.render();
  view.field("Name").props.onChange({ target: { value: "My draft" } });
  view.render();
  view.changeRemote(true);
  await view.submit();
  view.render();
  view.button("Reload latest and keep draft").props.onClick();
  await view.settle();
  assert.equal(view.button("Save").props.disabled, true);
  assert.equal(view.field("Name").props.value, "My draft");
  view.button("Keep my draft").props.onClick();
  view.render();
  await view.submit();
  assert.equal(view.saved().catalog.commands[0].name, "My draft");
});

test("lost creation response is reconciled by the stable draft ID without creating duplicates", async () => {
  const view = editor();
  view.render();
  await view.settle();
  assert.ok(
    view.nodes().some((node) => node.props?.children === "server/default.json"),
  );
  view.button("New").props.onClick();
  view.render();
  view.field("Name").props.onChange({ target: { value: "New command" } });
  view.render();
  view
    .field("Command content")
    .props.onChange({ target: { value: "echo test" } });
  view.render();
  view.loseNextResponse();
  await view.submit();
  view.render();
  assert.equal(view.button("Save").props.disabled, true);
  const createdId = view.saved().catalog.commands.at(-1).id;
  view.button("Reload latest and keep draft").props.onClick();
  await view.settle();
  assert.equal(view.field("Name"), undefined);
  assert.equal(view.latest().filter((item) => item.id === createdId).length, 1);
  assert.equal(view.requestCount(), 1);
  assert.equal(view.saved().catalog.commands.at(-1).group, "General");
  assert.equal("group_name" in view.saved().catalog.commands.at(-1), false);
});

test("editing a draft after a lost response updates its original ID rather than appending", async () => {
  const view = editor();
  view.render();
  await view.settle();
  view.button("New").props.onClick();
  view.render();
  view.field("Name").props.onChange({ target: { value: "First name" } });
  view.render();
  view
    .field("Command content")
    .props.onChange({ target: { value: "echo test" } });
  view.render();
  view.loseNextResponse();
  await view.submit();
  view.render();
  const createdId = view.saved().catalog.commands.at(-1).id;
  view.field("Name").props.onChange({ target: { value: "Revised name" } });
  view.render();
  view.button("Reload latest and keep draft").props.onClick();
  await view.settle();
  view.button("Keep my draft").props.onClick();
  view.render();
  await view.submit();
  view.render();
  assert.equal(view.latest().length, 2);
  assert.equal(view.latest().filter((item) => item.id === createdId).length, 1);
  assert.equal(view.latest().at(-1).name, "Revised name");
});

test("a deleted command can be saved as a new command with a stable identity", async () => {
  const view = editor();
  view.render();
  await view.settle();
  view.button("Edit").props.onClick();
  view.render();
  view.field("Name").props.onChange({ target: { value: "Recovered draft" } });
  view.render();
  view.deleteRemote();
  await view.submit();
  view.render();
  view.button("Reload latest and keep draft").props.onClick();
  await view.settle();
  view.button("Save draft as new command").props.onClick();
  view.render();
  view.loseNextResponse();
  await view.submit();
  view.render();
  assert.notEqual(view.saved().catalog.commands[0].id, "one");
  view.button("Reload latest and keep draft").props.onClick();
  await view.settle();
  assert.equal(view.latest().length, 1);
  assert.equal(view.field("Name"), undefined);
});
