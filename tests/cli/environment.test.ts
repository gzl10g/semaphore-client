import { test } from "node:test";
import assert from "node:assert/strict";
import type { SemaphoreClient } from "../../src/client.js";
import type { CreateEnvironmentInput } from "../../src/types.js";
import { handleEnvironmentList, handleEnvironmentGet, handleEnvironmentCreate } from "../../src/cli/environment.js";

const MOCK_ENV = {
  id: 1,
  name: "prod-vars",
  project_id: 1,
  password: "secret",
};

function makeMockClient() {
  let lastCreateCall: CreateEnvironmentInput | undefined;
  const client = {
    environment: {
      list: async () => [MOCK_ENV],
      get: async (_pid: number, id: number) => (id === 1 ? MOCK_ENV : null),
      create: async (input: CreateEnvironmentInput) => {
        lastCreateCall = input;
        return { ...MOCK_ENV, id: 2 };
      },
      update: async () => {},
      delete: async () => {},
    },
  } as unknown as SemaphoreClient;
  return { client, getLastCreate: () => lastCreateCall };
}

const { client: mockClient } = makeMockClient();
const DEPS = { client: mockClient, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };

function captureLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return { lines, restore: () => { console.log = original; } };
}

test("handleEnvironmentList outputs table with env name", async () => {
  const cap = captureLog();
  try {
    await handleEnvironmentList(1, { json: false }, DEPS);
  } finally {
    cap.restore();
  }
  const output = cap.lines.join("\n");
  assert.ok(output.includes("prod-vars"), `Expected "prod-vars" in output:\n${output}`);
});

test("handleEnvironmentGet id:99 throws Error for not found", async () => {
  await assert.rejects(
    () => handleEnvironmentGet(1, 99, { json: false }, DEPS),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("not found"));
      return true;
    },
  );
});

function makeDeps() {
  const { client, getLastCreate } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  return { deps, getLastCreate };
}

test("crea environment con variables inline", async () => {
  const { deps, getLastCreate } = makeDeps();
  await handleEnvironmentCreate(1, { name: "test", vars: ["TZ=UTC", "FOO=bar"] }, { json: false }, deps);
  const created = getLastCreate();
  assert.equal(created?.env, '{"TZ":"UTC","FOO":"bar"}');
  assert.equal(created?.json, undefined);
});

test("crea environment cargando variables desde fichero .env", async () => {
  const { deps, getLastCreate } = makeDeps();
  await handleEnvironmentCreate(1, { name: "test", fromEnv: "tests/fixtures/base.env" }, { json: false }, deps);
  const created = getLastCreate();
  assert.ok(created?.env !== undefined, "env should be set");
  const parsed = JSON.parse(created!.env!) as Record<string, string>;
  assert.equal(parsed["TZ"], "Europe/Madrid");
  assert.equal(parsed["DB_HOST"], "test-host");
  assert.ok("DB_URL" in parsed);
});

test("las --var sobreescriben claves del .env cuando se combinan", async () => {
  const { deps, getLastCreate } = makeDeps();
  await handleEnvironmentCreate(
    1,
    { name: "test", fromEnv: "tests/fixtures/base.env", vars: ["TZ=UTC"] },
    { json: false },
    deps,
  );
  const created = getLastCreate();
  const parsed = JSON.parse(created!.env!) as Record<string, string>;
  assert.equal(parsed["TZ"], "UTC");
});

test("rechaza --var sin formato KEY=VALUE", async () => {
  const { deps } = makeDeps();
  await assert.rejects(
    () => handleEnvironmentCreate(1, { name: "test", vars: ["INVALIDA"] }, { json: false }, deps),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("--var must be KEY=VALUE"));
      return true;
    },
  );
});

test("rechaza --var con key vacía", async () => {
  const { deps } = makeDeps();
  await assert.rejects(
    () => handleEnvironmentCreate(1, { name: "test", vars: ["=VALUE"] }, { json: false }, deps),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("key cannot be empty"));
      return true;
    },
  );
});

test("rechaza --from-env con fichero inexistente", async () => {
  const { deps } = makeDeps();
  await assert.rejects(
    () => handleEnvironmentCreate(1, { name: "test", fromEnv: "tests/fixtures/no-existe.env" }, { json: false }, deps),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("env file not found"));
      return true;
    },
  );
});

test("envía variables al campo json cuando se usa --secret", async () => {
  const { deps, getLastCreate } = makeDeps();
  await handleEnvironmentCreate(1, { name: "test", vars: ["TOKEN=xyz"], secret: true }, { json: false }, deps);
  const created = getLastCreate();
  assert.equal(created?.json, '{"TOKEN":"xyz"}');
  assert.equal(created?.env, undefined);
});

test("crea environment sin variables", async () => {
  const { deps, getLastCreate } = makeDeps();
  await handleEnvironmentCreate(1, { name: "test" }, { json: false }, deps);
  const created = getLastCreate();
  assert.equal(created?.env, undefined);
  assert.equal(created?.json, undefined);
});
