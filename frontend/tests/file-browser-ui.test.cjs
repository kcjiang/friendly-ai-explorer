const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");

function browser({
  role = "engineer",
  knowledge = false,
  multiple = false,
  failDeleteOnce = false,
} = {}) {
  const slots = [],
    effects = [],
    requests = [];
  let cursor = 0,
    tree;
  const entry = {
    id: "folder",
    name: "Reports",
    path: "Reports",
    space: "public",
    is_dir: true,
    size: 0,
    updated_at: "2026-10-28T00:00:00Z",
    creator: null,
  };
  const dataset = multiple
    ? [entry, { ...entry, id: "second", name: "notes.txt", is_dir: false }]
    : [entry];
  const mutations = [];
  let failed = false;
  const react = {
    Fragment: "Fragment",
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
    useRef(initial) {
      const i = cursor++;
      return (slots[i] ??= { current: initial });
    },
    useCallback(fn) {
      return fn;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || deps.some((value, j) => value !== slots[i][j]))
        effects.push(fn);
      slots[i] = deps;
    },
  };
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync("src/components/files/file-browser.tsx", "utf8"),
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
      AbortController,
      window: { addEventListener() {}, removeEventListener() {} },
      require(name) {
        if (name === "@tanstack/react-table")
          return {
            tableFeatures: (features) => features,
            createColumnHelper: () => ({
              columns: (columns) => columns,
              accessor: (key, options) => ({ key, ...options }),
            }),
            useTable: (options) => {
              const selected = options.state.rowSelection;
              const rows = options.data.map((original) => ({
                id: original.id,
                original,
                getIsSelected: () => !!selected[original.id],
                toggleSelected: (checked) => {
                  const next = { ...selected };
                  if (checked) next[original.id] = true;
                  else delete next[original.id];
                  options.onRowSelectionChange(next);
                },
              }));
              const selectedRows = rows.filter((row) => row.getIsSelected());
              return {
                getRowModel: () => ({ rows }),
                getSelectedRowModel: () => ({ rows: selectedRows }),
                getRowCount: () => options.rowCount,
                getPageCount: () => Math.ceil(options.rowCount / 50),
                getCanPreviousPage: () =>
                  options.state.pagination.pageIndex > 0,
                getCanNextPage: () =>
                  (options.state.pagination.pageIndex + 1) * 50 <
                  options.rowCount,
                getIsAllPageRowsSelected: () =>
                  rows.length > 0 && selectedRows.length === rows.length,
                getIsSomePageRowsSelected: () =>
                  selectedRows.length > 0 && selectedRows.length < rows.length,
                toggleAllPageRowsSelected: (checked) =>
                  options.onRowSelectionChange(
                    checked
                      ? Object.fromEntries(rows.map((row) => [row.id, true]))
                      : {},
                  ),
                resetRowSelection: () => options.onRowSelectionChange({}),
                previousPage: () =>
                  options.onPaginationChange({
                    pageIndex: options.state.pagination.pageIndex - 1,
                    pageSize: 50,
                  }),
                nextPage: () =>
                  options.onPaginationChange({
                    pageIndex: options.state.pagination.pageIndex + 1,
                    pageSize: 50,
                  }),
              };
            },
          };
        if (name === "react") return react;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        if (name === "next-auth/react")
          return { useSession: () => ({ data: { user: { id: "me", role } } }) };
        if (name === "next-intl") return { useLocale: () => "en" };
        if (name === "next/dynamic") return { default: () => "TicketModal" };
        if (name === "@/lib/errors")
          return { errorMessage: (error) => error.message };
        if (name === "@/lib/api")
          return {
            default: {
              delete: async (url) => {
                mutations.push(url);
                if (failDeleteOnce && url.endsWith("/second") && !failed) {
                  failed = true;
                  throw new Error("Temporary failure");
                }
                return { data: {} };
              },
              post: async (url, body) => {
                mutations.push({ url, body });
                return { data: {} };
              },
              get: async (url, options) => {
                requests.push({ url, params: options?.params });
                if (url.endsWith("/exists")) return { data: { exists: false } };
                if (url.endsWith("/usage"))
                  return {
                    data: {
                      total_bytes: 1000,
                      used_bytes: 100,
                      personal_bytes: 50,
                      personal_limit: 500,
                      knowledge_bytes: 10,
                      disk_free_bytes: 900,
                      reserved_bytes: 0,
                      personal_reserved_bytes: 0,
                    },
                  };
                if (url.endsWith("/shared") || url.endsWith("/trash"))
                  return { data: dataset };
                if (url.endsWith("/ticket-archive"))
                  return {
                    data: {
                      items: [
                        {
                          ...entry,
                          is_dir: false,
                          name: "log.txt",
                          ticket_id: "ticket",
                        },
                      ],
                      total: 1,
                    },
                  };
                if (url.endsWith("/entries"))
                  return {
                    data: {
                      items: options?.params?.path ? [] : dataset,
                      total: options?.params?.path ? 0 : dataset.length,
                    },
                  };
                throw new Error(`Unexpected request: ${url}`);
              },
            },
          };
        return new Proxy({}, { get: (_target, key) => key });
      },
    },
  );
  function nodes(value) {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap(nodes);
    return [
      value,
      ...nodes(value.props?.children),
      ...nodes(value.props?.render),
      ...nodes(value.props?.navigation),
      ...nodes(value.props?.mobileNavigation),
    ];
  }
  function render() {
    cursor = 0;
    tree = exports.default({ knowledge });
    while (effects.length) effects.shift()();
  }
  async function settle() {
    await new Promise(setImmediate);
    render();
    await new Promise(setImmediate);
    render();
  }
  const all = () => nodes(tree);
  const find = (type, label) =>
    all().find(
      (node) => node.type === type && (!label || allText(node).includes(label)),
    );
  function allText(node) {
    if (typeof node === "string") return node;
    if (Array.isArray(node)) return node.map(allText).join("");
    return node?.props ? allText(node.props.children) : "";
  }
  render();
  return {
    render,
    settle,
    all,
    find,
    requests,
    mutations,
    switchSpace: (space) => {
      const labels = {
        public: "Public space",
        personal: "My space",
        shared: "Shared with me",
        trash: "Public recycle bin",
        attachments: "My attachments",
      };
      all()
        .find(
          (node) =>
            node.type === "Button" &&
            node.props["aria-label"] === labels[space],
        )
        .props.onClick();
      render();
    },
  };
}

test("switching storage spaces clears the folder and search before requesting the next space", async () => {
  const view = browser();
  await view.settle();
  view
    .all()
    .find((node) => node.type === "TableRow" && node.props.tabIndex === 0)
    .props.onClick();
  view.render();
  await view.settle();
  assert.equal(
    view.find("BreadcrumbPage", "Reports").props.children,
    "Reports",
  );
  view
    .find("InputGroupInput")
    .props.onChange({ target: { value: "old query" } });
  view.render();
  view.switchSpace("personal");
  await view.settle();
  const request = view.requests
    .filter((r) => r.url.endsWith("/entries"))
    .at(-1);
  assert.equal(request.params.space, "personal");
  assert.equal(request.params.path, "");
  assert.equal(request.params.q, "");
  assert.equal(view.find("InputGroupInput").props.value, "");
});

test("shared files and ticket attachments retain their read-only menus", async () => {
  const view = browser();
  await view.settle();
  for (const space of ["shared", "attachments"]) {
    view.switchSpace(space);
    await view.settle();
    for (const label of ["Move", "Rename", "Delete", "Share"])
      assert.equal(view.find("ContextMenuItem", label), undefined);
    assert.equal(
      view
        .all()
        .some(
          (node) => node.type === "Button" && node.props.children === "Upload",
        ),
      false,
    );
    assert.equal(view.find("Button", "New folder"), undefined);
  }
});

test("capacity details are readable without querying privileged settings or offering a save action", async () => {
  const view = browser();
  await view.settle();
  view.find("Button", "Storage usage").props.onClick();
  view.render();
  await view.settle();
  assert.ok(view.find("DialogTitle", "Storage usage"));
  assert.equal(view.find("Button", "Capacity settings"), undefined);
  assert.equal(view.find("Button", "Confirm"), undefined);
  assert.equal(
    view.requests.some((r) => r.url.endsWith("/capacity")),
    false,
  );
});

test("knowledge retains its own scope without showing storage space tabs", async () => {
  const view = browser({ knowledge: true });
  await view.settle();
  assert.equal(
    view.requests.find((r) => r.url.endsWith("/entries")).params.space,
    "knowledge",
  );
  assert.equal(view.find("TabsList"), undefined);
  assert.ok(view.find("MenubarItem", "New Markdown"));
});

test("closing capacity details preserves the content and hides confirm throughout the exit animation", async () => {
  const view = browser();
  await view.settle();
  view.find("Button", "Storage usage").props.onClick();
  view.render();
  await view.settle();
  const dialog = () =>
    view
      .all()
      .find(
        (node) => node.type === "Dialog" && node.props.onOpenChangeComplete,
      );
  assert.equal(dialog().props.open, true);
  view.find("Button", "Close").props.onClick();
  view.render();
  assert.equal(dialog().props.open, false);
  assert.ok(view.find("DialogTitle", "Storage usage"));
  assert.equal(view.find("Button", "Confirm"), undefined);
  dialog().props.onOpenChangeComplete(false);
  view.render();
  assert.equal(view.find("DialogTitle", "Storage usage"), undefined);
  assert.equal(view.find("Button", "Confirm"), undefined);
});

test("sort headers toggle direction and send sorting to paginated endpoints", async () => {
  const view = browser();
  await view.settle();
  assert.equal(
    view.requests.find((r) => r.url.endsWith("/entries")).params.sort,
    "name",
  );
  view.find("Button", "Size").props.onClick();
  view.render();
  await view.settle();
  let request = view.requests.filter((r) => r.url.endsWith("/entries")).at(-1);
  assert.equal(request.params.sort, "size");
  assert.equal(request.params.direction, "asc");
  view.find("Button", "Size").props.onClick();
  view.render();
  await view.settle();
  request = view.requests.filter((r) => r.url.endsWith("/entries")).at(-1);
  assert.equal(request.params.direction, "desc");
  view.switchSpace("attachments");
  await view.settle();
  request = view.requests
    .filter((r) => r.url.endsWith("/ticket-archive"))
    .at(-1);
  assert.equal(request.params.sort, "size");
  assert.equal(request.params.direction, "desc");
});

test("mobile space picker opens an accessible panel and closes after switching", async () => {
  const view = browser();
  await view.settle();
  view
    .all()
    .find(
      (n) =>
        n.type === "Button" && n.props["aria-label"] === "Choose storage space",
    )
    .props.onClick();
  view.render();
  assert.equal(
    view.all().find((n) => n.type === "Dialog" && n.props.open === true).props
      .open,
    true,
  );
  const nav = view
    .all()
    .find(
      (n) =>
        n.type === "nav" && n.props["aria-label"] === "Switch storage space",
    );
  nav.props.children[1].props.onClick();
  view.render();
  await view.settle();
  assert.equal(
    view.requests.filter((r) => r.url.endsWith("/entries")).at(-1).params.space,
    "personal",
  );
  assert.equal(
    view.all().some((n) => n.type === "Dialog" && n.props.open === true),
    false,
  );
});

test("column widths can be resized by keyboard without opening a folder", async () => {
  const view = browser();
  await view.settle();
  const separator = () =>
    view.all().find((n) => n.props?.["aria-label"] === "Resize Name");
  assert.equal(separator().props["aria-valuenow"], 43);
  separator().props.onKeyDown({ key: "ArrowRight", preventDefault() {} });
  view.render();
  assert.equal(separator().props["aria-valuenow"], 45);
  separator().props.onDoubleClick();
  view.render();
  assert.equal(separator().props["aria-valuenow"], 43);
});

test("batch deletion retries only failed items after partial completion", async () => {
  const view = browser({ multiple: true, failDeleteOnce: true });
  await view.settle();
  view.find("Checkbox").props.onCheckedChange(true);
  view.render();
  view.find("MenubarItem", "Delete").props.onClick();
  view.render();
  view.find("Button", "Confirm").props.onClick();
  await view.settle();
  assert.deepEqual(view.mutations, [
    "/api/v1/files/folder",
    "/api/v1/files/second",
  ]);
  view.find("Button", "Confirm").props.onClick();
  await view.settle();
  assert.deepEqual(view.mutations, [
    "/api/v1/files/folder",
    "/api/v1/files/second",
    "/api/v1/files/second",
  ]);
});

test("batch copy submits every checked entry to the selected destination", async () => {
  const view = browser({ multiple: true });
  await view.settle();
  view.find("Checkbox").props.onCheckedChange(true);
  view.render();
  view.find("MenubarItem", "Copy to").props.onClick();
  view.render();
  await view.settle();
  view.find("Button", "Confirm").props.onClick();
  await view.settle();
  assert.deepEqual(
    view.mutations.map((item) => item.url),
    ["/api/v1/files/folder/transfer", "/api/v1/files/second/transfer"],
  );
  assert.ok(
    view.mutations.every(
      (item) => item.body.copy && item.body.space === "public",
    ),
  );
});

test("selection footer uses real row counts and follows select-all and clear selection", async () => {
  const view = browser({ multiple: true });
  await view.settle();
  const footer = () =>
    view.find("span", "row(s) selected.").props.children.join("");
  assert.equal(footer(), "0 of 2 row(s) selected.");
  view.find("Checkbox").props.onCheckedChange(true);
  view.render();
  assert.equal(footer(), "2 of 2 row(s) selected.");
  view.find("MenubarItem", "Clear selection").props.onClick();
  view.render();
  assert.equal(footer(), "0 of 2 row(s) selected.");
});
