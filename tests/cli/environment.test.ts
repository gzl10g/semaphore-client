import { test } from "node:test";
import assert from "node:assert/strict";
import type { SemaphoreClient } from "../../src/client.js";
import type { CreateEnvironmentInput } from "../../src/types.js";
import { handleEnvironmentList, handleEnvironmentGet, handleEnvironmentCreate, handleEnvironmentUpdate } from "../../src/cli/environment.js";

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

// — los cuatro cuadrantes de un variable group (2.19) —

test("environment create reparte planas y secretas en sus cuatro sitios", async () => {
  const { client, getLastCreate } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  const cap = captureLog();
  try {
    await handleEnvironmentCreate(
      1,
      {
        name: "4q",
        vars: ["PLAIN_ENV=1"],
        extraVars: ["PLAIN_EXTRA=2"],
        secretVars: ["SECRET_EXTRA=aaa"],
        secretEnvs: ["SECRET_ENV=bbb"],
      },
      { json: true },
      deps,
    );
  } finally {
    cap.restore();
  }

  const call = getLastCreate();
  assert.ok(call, "create was called");
  assert.equal(call.env, JSON.stringify({ PLAIN_ENV: "1" }), "--var son variables de entorno planas");
  assert.equal(call.json, JSON.stringify({ PLAIN_EXTRA: "2" }), "--extra-var son extra variables planas");
  assert.deepEqual(call.secrets, [
    { type: "var", name: "SECRET_EXTRA", secret: "aaa" },
    { type: "env", name: "SECRET_ENV", secret: "bbb" },
  ]);
});

test("environment create rechaza un secreto que no sea KEY=VALUE", async () => {
  const { client } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await assert.rejects(
    () => handleEnvironmentCreate(1, { name: "x", secretVars: ["SIN_IGUAL"] }, { json: true }, deps),
    (e: unknown) => e instanceof Error && /--secret-var must be KEY=VALUE/.test(e.message),
  );
});

// — update: rotar, borrar y desambiguar secretos —

function makeSecretClient(secrets: unknown[] | undefined) {
  let lastUpdate: { id: number; input: Record<string, unknown> } | undefined;
  const client = {
    environment: {
      get: async () => ({ id: 5, name: "env", project_id: 1, secrets }),
      update: async (_p: number, id: number, input: Record<string, unknown>) => {
        lastUpdate = { id, input };
      },
    },
  } as unknown as SemaphoreClient;
  return { client, getLastUpdate: () => lastUpdate };
}

const DEPS_FOR = (client: SemaphoreClient) => ({
  client,
  config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 },
});

test("--secret-var sobre un secreto que ya existe lo actualiza, no lo duplica", async () => {
  const { client, getLastUpdate } = makeSecretClient([{ id: 7, type: "var", name: "TOKEN", secret: "" }]);
  const cap = captureLog();
  try {
    await handleEnvironmentUpdate(1, 5, { secretVars: ["TOKEN=nuevo"] }, { json: false }, DEPS_FOR(client));
  } finally {
    cap.restore();
  }
  assert.deepEqual(getLastUpdate()?.input["secrets"], [
    { type: "var", name: "TOKEN", secret: "nuevo", id: 7, operation: "update" },
  ]);
});

test("--delete-secret con el mismo nombre en los dos tipos se niega en vez de borrar el que no es", async () => {
  const { client, getLastUpdate } = makeSecretClient([
    { id: 10, type: "env", name: "TOKEN", secret: "" },
    { id: 11, type: "var", name: "TOKEN", secret: "" },
  ]);
  await assert.rejects(
    () => handleEnvironmentUpdate(1, 5, { deleteSecrets: ["TOKEN"] }, { json: false }, DEPS_FOR(client)),
    (e: unknown) => e instanceof Error && /ambiguous/.test(e.message),
  );
  assert.equal(getLastUpdate(), undefined, "no debe mandarse ningún update");
});

test("--delete-secret-var desambigua y borra el correcto", async () => {
  const { client, getLastUpdate } = makeSecretClient([
    { id: 10, type: "env", name: "TOKEN", secret: "" },
    { id: 11, type: "var", name: "TOKEN", secret: "" },
  ]);
  const cap = captureLog();
  try {
    await handleEnvironmentUpdate(1, 5, { deleteSecretVars: ["TOKEN"] }, { json: false }, DEPS_FOR(client));
  } finally {
    cap.restore();
  }
  assert.deepEqual(getLastUpdate()?.input["secrets"], [
    { id: 11, name: "TOKEN", type: "var", operation: "delete" },
  ]);
});

test("--delete-secret sobre un environment sin secretos lo dice, en vez de 'ese nombre no existe'", async () => {
  const { client } = makeSecretClient(undefined);
  await assert.rejects(
    () => handleEnvironmentUpdate(1, 5, { deleteSecrets: ["TOKEN"] }, { json: false }, DEPS_FOR(client)),
    (e: unknown) => e instanceof Error && /has no secrets/.test(e.message),
  );
});

test("--delete-secret aborta entero si uno de los nombres no existe", async () => {
  const { client, getLastUpdate } = makeSecretClient([{ id: 7, type: "var", name: "A", secret: "" }]);
  await assert.rejects(
    () => handleEnvironmentUpdate(1, 5, { deleteSecrets: ["A", "NO_EXISTE"] }, { json: false }, DEPS_FOR(client)),
    (e: unknown) => e instanceof Error && /NO_EXISTE/.test(e.message),
  );
  assert.equal(getLastUpdate(), undefined, "ni borrado parcial ni update a medias");
});

test("--var reemplaza las variables de entorno sin tocar las extra", async () => {
  const { client, getLastUpdate } = makeSecretClient([]);
  const cap = captureLog();
  try {
    await handleEnvironmentUpdate(1, 5, { vars: ["A=1"] }, { json: false }, DEPS_FOR(client));
  } finally {
    cap.restore();
  }
  const input = getLastUpdate()?.input ?? {};
  assert.equal(input["env"], JSON.stringify({ A: "1" }));
  assert.ok(!("json" in input), "las extra variables no se tocan");
});

test("un valor con = dentro se conserva entero", async () => {
  const { client, getLastUpdate } = makeSecretClient([]);
  const cap = captureLog();
  try {
    await handleEnvironmentUpdate(1, 5, { secretVars: ["TOKEN=abc=def=="] }, { json: false }, DEPS_FOR(client));
  } finally {
    cap.restore();
  }
  const secrets = getLastUpdate()?.input["secrets"] as Array<{ secret: string }>;
  assert.equal(secrets[0]?.secret, "abc=def==");
});

test("--secret junto a --extra-var se niega en vez de descartar las extra vars", async () => {
  const { client } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await assert.rejects(
    () => handleEnvironmentCreate(1, { name: "x", extraVars: ["A=1"], vars: ["B=2"], secret: true }, { json: true }, deps),
    (e: unknown) => e instanceof Error && /--secret and --extra-var/.test(e.message),
  );
});
