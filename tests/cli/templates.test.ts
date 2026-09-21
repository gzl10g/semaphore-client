import { test } from "node:test";
import assert from "node:assert/strict";
import type { SemaphoreClient } from "../../src/client.js";
import {
  handleTemplatesList,
  handleTemplatesGet,
  handleTemplatesCreate,
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
