import { test } from "node:test";
import assert from "node:assert/strict";
import type { SemaphoreClient } from "../../src/client.js";
import { handleInventoryList, handleInventoryGet, handleInventoryCreate, handleInventoryUpdate } from "../../src/cli/inventory.js";

const MOCK_INVENTORY = {
  id: 1,
  name: "production",
  project_id: 1,
  inventory: "[servers]\nweb01 ansible_host=192.0.2.10",
  type: "static" as const,
  ssh_key_id: 2,
};

type CreateArgs = Parameters<SemaphoreClient["inventory"]["create"]>[0];

function makeMockClient() {
  let lastCreate: CreateArgs | undefined;
  const client = {
    inventory: {
      list: async () => [MOCK_INVENTORY],
      get: async (_pid: number, id: number) => (id === 1 ? MOCK_INVENTORY : null),
      create: async (input: CreateArgs) => {
        lastCreate = input;
        return { ...MOCK_INVENTORY, id: 2 };
      },
      update: async () => {},
      delete: async () => {},
    },
  } as unknown as SemaphoreClient;
  return { client, getLastCreate: () => lastCreate };
}

const mockClient = makeMockClient().client;

const DEPS = { client: mockClient, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };

function captureLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return { lines, restore: () => { console.log = original; } };
}

test("handleInventoryList outputs table with inventory name", async () => {
  const cap = captureLog();
  try {
    await handleInventoryList(1, { json: false }, DEPS);
  } finally {
    cap.restore();
  }
  const output = cap.lines.join("\n");
  assert.ok(output.includes("production"), `Expected "production" in output:\n${output}`);
});

test("handleInventoryGet id:99 throws Error for not found", async () => {
  await assert.rejects(
    () => handleInventoryGet(1, 99, { json: false }, DEPS),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("not found"));
      return true;
    },
  );
});

test("crea inventory con contenido inline", async () => {
  const { client, getLastCreate } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  const cap = captureLog();
  try {
    await handleInventoryCreate(
      1,
      { name: "test", inventory: "[all]\nhost1", type: "static", sshKeyId: 2 },
      { json: false },
      deps,
    );
  } finally {
    cap.restore();
  }
  const created = getLastCreate();
  assert.ok(created !== undefined, "create should have been called");
  assert.equal(created!.inventory, "[all]\nhost1");
});

test("crea inventory leyendo contenido desde fichero", async () => {
  const { client, getLastCreate } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  const cap = captureLog();
  try {
    await handleInventoryCreate(
      1,
      { name: "from-file", type: "static", sshKeyId: 2, inventoryFile: "tests/fixtures/hosts.ini" },
      { json: false },
      deps,
    );
  } finally {
    cap.restore();
  }
  const created = getLastCreate();
  assert.ok(created !== undefined, "create should have been called");
  assert.ok(created!.inventory.includes("web01.example.test"), "should contain fixture content");
});

test("rechaza --inventory y --inventory-file simultáneos", async () => {
  const { client } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await assert.rejects(
    () =>
      handleInventoryCreate(
        1,
        { name: "x", inventory: "[all]\nhost1", inventoryFile: "tests/fixtures/hosts.ini", type: "static", sshKeyId: 2 },
        { json: false },
        deps,
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("mutually exclusive"));
      return true;
    },
  );
});

test("rechaza crear inventory sin especificar contenido", async () => {
  const { client } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await assert.rejects(
    () =>
      handleInventoryCreate(
        1,
        { name: "x", type: "static", sshKeyId: 2 },
        { json: false },
        deps,
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("inventory content required"));
      return true;
    },
  );
});

test("rechaza --inventory-file con ruta inexistente", async () => {
  const { client } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await assert.rejects(
    () =>
      handleInventoryCreate(
        1,
        { name: "x", type: "static", sshKeyId: 2, inventoryFile: "tests/fixtures/does-not-exist.ini" },
        { json: false },
        deps,
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("inventory file not found"), `unexpected message: ${(err as Error).message}`);
      return true;
    },
  );
});

// — P12: --type file es una RUTA —

test("inventory create --type file refuses --inventory-file, and --repository-id needs --type file", async () => {
  const created: unknown[] = [];
  const client = { inventory: { create: async (i: unknown) => { created.push(i); return { id: 1 }; } } } as unknown as SemaphoreClient;
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await assert.rejects(() => handleInventoryCreate(1, { name: "f", type: "file", inventoryFile: "/etc/hosts" }, {}, deps), /stores the PATH/);
  await assert.rejects(() => handleInventoryCreate(1, { name: "s", type: "static", inventory: "x", repositoryId: 2 }, {}, deps), /--repository-id only applies to --type file/);
  const o = console.log;
  console.log = () => {};
  try {
    await handleInventoryCreate(1, { name: "f", type: "file", inventory: "inv/hosts.ini", repositoryId: 2, runnerTag: "gpu" }, { json: true }, deps);
  } finally {
    console.log = o;
  }
  assert.deepEqual(created[0], { name: "f", type: "file", inventory: "inv/hosts.ini", repositoryId: 2, runnerTag: "gpu", projectId: 1 });
});

test("inventory update --inventory-file checks the STORED type, and --json carries the stored inventory (P11)", async () => {
  const updates: unknown[] = [];
  const stored = { id: 6, name: "f", type: "file", inventory: "inv/hosts.ini", project_id: 1 };
  const client = {
    inventory: { get: async () => stored, update: async (...a: unknown[]) => { updates.push(a); } },
  } as unknown as SemaphoreClient;
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await assert.rejects(() => handleInventoryUpdate(1, 6, { inventoryFile: "/etc/hosts" }, {}, deps), /stores the PATH/);
  const lines: string[] = [];
  const o = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try {
    await handleInventoryUpdate(1, 6, { name: "g" }, { json: true }, deps);
  } finally {
    console.log = o;
  }
  const out = JSON.parse(lines.join("\n")) as Record<string, unknown>;
  assert.deepEqual([out["ok"], out["id"], out["inventory"]], [true, 6, stored]);
  assert.equal(updates.length, 1);
});
