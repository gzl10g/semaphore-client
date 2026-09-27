import { test } from "node:test";
import assert from "node:assert/strict";
import type { SemaphoreClient } from "../../src/client.js";
import {
  handleTemplatesList,
  handleTemplatesGet,
  handleTemplatesCreate,
  handleTemplatesUpdate,
} from "../../src/cli/templates.js";

const MOCK_TEMPLATE = {
  id: 1,
  name: "Deploy App",
  project_id: 1,
  inventory_id: 2,
  repository_id: 3,
  environment_id: 4,
  playbook: "site.yml",
  app: "ansible" as const,
  allow_override_args_in_task: false,
  type: "" as const,
};

const mockClient = {
  templates: {
    list: async () => [MOCK_TEMPLATE],
    get: async (_pid: number, id: number) => (id === 1 ? MOCK_TEMPLATE : null),
    create: async () => ({ ...MOCK_TEMPLATE, id: 2 }),
    update: async () => {},
    delete: async () => {},
  },
} as unknown as SemaphoreClient;

const DEPS = { client: mockClient, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };

function captureLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return { lines, restore: () => { console.log = original; } };
}

test("handleTemplatesList outputs table with template name", async () => {
  const cap = captureLog();
  try {
    await handleTemplatesList(1, { json: false }, DEPS);
  } finally {
    cap.restore();
  }
  const output = cap.lines.join("\n");
  assert.ok(output.includes("Deploy App"), `Expected "Deploy App" in output:\n${output}`);
});

test("handleTemplatesGet id:99 throws Error for not found", async () => {
  await assert.rejects(
    () => handleTemplatesGet(1, 99, { json: false }, DEPS),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("not found"));
      return true;
    },
  );
});

// — forma de --arguments: la API acepta cualquier JSON y revienta al ejecutar —

test("templates create rechaza un --arguments con forma que el servidor no sabe ejecutar", async () => {
  const deps = { client: mockClient, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  // Un mapa de stages es válido en terraform, pero NO en ansible: ahí el
  // ejecutor deserializa a []string y el objeto revienta al ejecutar.
  for (const bad of ['{"not":"an-array"}', '{"init":["-upgrade"]}', "42", "no-es-json"]) {
    await assert.rejects(
      () => handleTemplatesCreate(
        1,
        { name: "t", inventoryId: 1, repositoryId: 1, environmentId: 1, playbook: "p.yml", arguments: bad },
        { json: true },
        deps,
      ),
      (e: unknown) => e instanceof Error && /--arguments/.test(e.message),
      `debe rechazar ${bad} para una plantilla ansible`,
    );
  }
});

test("templates create acepta el array de strings, que es lo que el ejecutor deserializa", async () => {
  let captured: { arguments?: string } | undefined;
  const client = {
    templates: {
      create: async (input: { arguments?: string }) => {
        captured = input;
        return { ...MOCK_TEMPLATE, id: 2 };
      },
    },
  } as unknown as SemaphoreClient;
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  const original = console.log;
  console.log = () => {};
  try {
    await handleTemplatesCreate(
      1,
      { name: "t", inventoryId: 1, repositoryId: 1, environmentId: 1, playbook: "p.yml", arguments: '["--tags","deploy"]' },
      { json: true },
      deps,
    );
  } finally {
    console.log = original;
  }
  assert.equal(captured?.arguments, '["--tags","deploy"]');
});

test("templates create acepta el mapa de stages en terraform, que es una feature del servidor", async () => {
  let captured: { arguments?: string } | undefined;
  const client = {
    templates: {
      create: async (input: { arguments?: string }) => {
        captured = input;
        return { ...MOCK_TEMPLATE, id: 3 };
      },
    },
  } as unknown as SemaphoreClient;
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  const original = console.log;
  console.log = () => {};
  try {
    // `init` alimenta el `terraform init` (local_executor.go); rechazarlo rompía
    // las plantillas Terraform.
    await handleTemplatesCreate(
      1,
      {
        name: "tf", inventoryId: 1, repositoryId: 1, environmentId: 1, playbook: "main.tf",
        app: "terraform", arguments: '{"init":["-upgrade"],"apply":["-parallelism=4"]}',
      },
      { json: true },
      deps,
    );
  } finally {
    console.log = original;
  }
  assert.equal(captured?.arguments, '{"init":["-upgrade"],"apply":["-parallelism=4"]}');
});

// — --description: endpoint propio, y el PUT completo solo si hay algo más —

function clientRecordingWrites() {
  const calls: string[] = [];
  const client = {
    templates: {
      get: async () => ({ ...MOCK_TEMPLATE, description: "nueva", limit: ["web"], task_params: { limit: ["web"] } }),
      update: async (_p: number, _id: number, input: Record<string, unknown>) => { calls.push(`update ${JSON.stringify(input)}`); },
      setDescription: async (_p: number, _id: number, d: string) => { calls.push(`description ${d}`); },
    },
  } as unknown as SemaphoreClient;
  return { client, calls };
}

test("update with only --description goes through its own endpoint, no full PUT", async () => {
  const { client, calls } = clientRecordingWrites();
  const cap = captureLog();
  try {
    await handleTemplatesUpdate(1, 1, { description: "nueva" }, {}, { ...DEPS, client });
  } finally {
    cap.restore();
  }
  assert.deepEqual(calls, ["description nueva"]);
});

test("update with --description and another field does both", async () => {
  const { client, calls } = clientRecordingWrites();
  const cap = captureLog();
  try {
    await handleTemplatesUpdate(1, 1, { name: "x", description: "" }, {}, { ...DEPS, client });
  } finally {
    cap.restore();
  }
  assert.deepEqual(calls, ['update {"name":"x"}', "description "]);
});

test("update --json shows the template as stored, limit included", async () => {
  const { client } = clientRecordingWrites();
  const cap = captureLog();
  try {
    await handleTemplatesUpdate(1, 1, { description: "nueva" }, { json: true }, { ...DEPS, client });
  } finally {
    cap.restore();
  }
  const out = JSON.parse(cap.lines.join("\n")) as { ok: boolean; id: number; template: { description: string; limit: string[] } };
  assert.equal(out.ok, true);
  assert.equal(out.id, 1);
  assert.equal(out.template.description, "nueva");
  assert.deepEqual(out.template.limit, ["web"]);
});

test("the human view prints nested fields as JSON, not [object Object]", async () => {
  const client = {
    templates: { get: async () => ({ ...MOCK_TEMPLATE, task_params: { limit: ["!nas01.example.test"] } }) },
  } as unknown as SemaphoreClient;
  const cap = captureLog();
  try {
    await handleTemplatesGet(1, 1, {}, { ...DEPS, client });
  } finally {
    cap.restore();
  }
  assert.ok(cap.lines.includes('task_params: {"limit":["!nas01.example.test"]}'), cap.lines.join("\n"));
});

test("update without any field still reads and writes, so a missing template is an error", async () => {
  const { client, calls } = clientRecordingWrites();
  const cap = captureLog();
  try {
    await handleTemplatesUpdate(1, 1, {}, {}, { ...DEPS, client });
  } finally {
    cap.restore();
  }
  assert.deepEqual(calls, ["update {}"]);
});

test("a description that fails after the full PUT says the rest was saved", async () => {
  const { client } = clientRecordingWrites();
  (client.templates as unknown as { setDescription: () => Promise<void> }).setDescription = async () => { throw new Error("500"); };
  await assert.rejects(
    () => handleTemplatesUpdate(1, 1, { name: "x", description: "d" }, {}, { ...DEPS, client }),
    /other fields WERE saved, but the description was NOT \(500\)/,
  );
});

test("lists of plain values keep their old human format", async () => {
  const client = {
    templates: { get: async () => ({ ...MOCK_TEMPLATE, environment_ids: [3, 4] }) },
  } as unknown as SemaphoreClient;
  const cap = captureLog();
  try {
    await handleTemplatesGet(1, 1, {}, { ...DEPS, client });
  } finally {
    cap.restore();
  }
  assert.ok(cap.lines.includes("environment_ids: 3,4"), cap.lines.join("\n"));
});

// — P3: --vault-key-id → vaults de la plantilla —

function vaultClient(keyType: string, created: unknown[]) {
  return {
    keys: { get: async (_p: number, id: number) => (id === 404 ? null : { id, type: keyType }) },
    templates: {
      create: async (i: unknown) => { created.push(i); return { id: 9, name: "t" }; },
    },
  } as unknown as SemaphoreClient;
}
const CFGV = { version: 1 as const, host: "http://x", token: "t", activeProject: 1 };
const BASE = { name: "t", inventoryId: 1, repositoryId: 1, environmentId: 1, playbook: "v.yml" };

async function silent(fn: () => Promise<void>) {
  const o = console.log;
  console.log = () => {};
  try { await fn(); } finally { console.log = o; }
}

test("--vault-key-id becomes a password vault, named when given as name=id", async () => {
  const created: unknown[] = [];
  await silent(() => handleTemplatesCreate(1, { ...BASE, vaultKeyIds: ["8", "prod=9"] }, { json: true }, { client: vaultClient("login_password", created), config: CFGV }));
  assert.deepEqual((created[0] as { vaults: unknown }).vaults, [
    { type: "password", vault_key_id: 8 },
    { type: "password", vault_key_id: 9, name: "prod" },
  ]);
});

test("--vault-key-id refuses a key that is not login_password, a missing one, bad syntax and two unnamed vaults", async () => {
  const cases: [string[], string, RegExp][] = [
    [["4"], "string", /must be a login_password key/],
    [["404"], "login_password", /does not exist/],
    [["abc"], "login_password", /must be <id> or <name>=<id>/],
    [["1", "2"], "login_password", /distinct names/],
  ];
  for (const [specs, type, re] of cases) {
    const created: unknown[] = [];
    await assert.rejects(() => handleTemplatesCreate(1, { ...BASE, vaultKeyIds: specs }, {}, { client: vaultClient(type, created), config: CFGV }), re);
    assert.equal(created.length, 0);
  }
});
