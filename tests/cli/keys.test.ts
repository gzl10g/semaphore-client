import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import type { SemaphoreClient } from "../../src/client.js";
import { handleKeysList, handleKeysGet, handleKeysCreate, handleKeysUpdate } from "../../src/cli/keys.js";
import type { CreateKeyInput, UpdateKeyInput } from "../../src/types.js";

const MOCK_KEY = { id: 1, name: "Deploy Key", type: "ssh" as const, project_id: 1 };

function makeMockClient() {
  let lastCreateCall: CreateKeyInput | undefined;
  let lastUpdateCall: { id: number; input: UpdateKeyInput } | undefined;
  const client = {
    keys: {
      list: async () => [MOCK_KEY],
      get: async (_pid: number, id: number) => (id === 1 ? MOCK_KEY : null),
      create: async (input: CreateKeyInput) => {
        lastCreateCall = input;
        return { ...MOCK_KEY, id: 2 };
      },
      update: async (_pid: number, id: number, input: UpdateKeyInput) => {
        lastUpdateCall = { id, input };
      },
      delete: async () => {},
    },
  } as unknown as SemaphoreClient;
  return { client, getLastCreate: () => lastCreateCall, getLastUpdate: () => lastUpdateCall };
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

test("handleKeysList outputs table with key name", async () => {
  const cap = captureLog();
  try {
    await handleKeysList(1, { json: false }, DEPS);
  } finally {
    cap.restore();
  }
  const output = cap.lines.join("\n");
  assert.ok(output.includes("Deploy Key"), `Expected "Deploy Key" in output:\n${output}`);
});

test("handleKeysGet id:99 throws Error for not found", async () => {
  await assert.rejects(
    () => handleKeysGet(1, 99, { json: false }, DEPS),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("not found"));
      return true;
    },
  );
});

test("crea key SSH con clave privada literal", async () => {
  const { client, getLastCreate } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await handleKeysCreate(1, { name: "mykey", type: "ssh", privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----" }, { json: true }, deps);
  const call = getLastCreate();
  assert.ok(call, "create was called");
  assert.equal(call!.secret?.privateKey, "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----");
});

test("crea key SSH leyendo la clave desde fichero", async () => {
  const { client, getLastCreate } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  const fixturePath = path.resolve("tests/fixtures/test_key.pem");
  await handleKeysCreate(1, { name: "file-key", type: "ssh", privateKeyFile: fixturePath }, { json: true }, deps);
  const call = getLastCreate();
  assert.ok(call, "create was called");
  const expected = fs.readFileSync(fixturePath, "utf8");
  assert.equal(call!.secret?.privateKey, expected);
});

test("rechaza crear key SSH sin clave privada", async () => {
  const { client } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await assert.rejects(
    () => handleKeysCreate(1, { name: "k", type: "ssh" }, { json: true }, deps),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("--type ssh requires"));
      return true;
    },
  );
});

test("rechaza --private-key y --private-key-file simultáneos", async () => {
  const { client } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await assert.rejects(
    () => handleKeysCreate(1, { name: "k", type: "ssh", privateKey: "abc", privateKeyFile: "/some/path" }, { json: true }, deps),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("mutually exclusive"));
      return true;
    },
  );
});

test("rechaza fichero de clave inexistente", async () => {
  const { client } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await assert.rejects(
    () => handleKeysCreate(1, { name: "k", type: "ssh", privateKeyFile: "/nonexistent/path/key.pem" }, { json: true }, deps),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("key file not found"));
      return true;
    },
  );
});

test("rechaza key SSH con clave privada vacía", async () => {
  const { client } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await assert.rejects(
    () => handleKeysCreate(1, { name: "k", type: "ssh", privateKey: "   " }, { json: true }, deps),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("private key cannot be empty"));
      return true;
    },
  );
});

test("crea key login con usuario y contraseña", async () => {
  const { client, getLastCreate } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await handleKeysCreate(1, { name: "login-key", type: "login", login: "admin", password: "s3cr3t" }, { json: true }, deps);
  const call = getLastCreate();
  assert.ok(call, "create was called");
  assert.equal(call!.secret?.login, "admin");
  assert.equal(call!.secret?.password, "s3cr3t");
});

test("rechaza key login sin --login", async () => {
  const { client } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await assert.rejects(
    () => handleKeysCreate(1, { name: "k", type: "login", password: "pw" }, { json: true }, deps),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("--type login requires"));
      return true;
    },
  );
});

test("rechaza key login con --login pero sin --password", async () => {
  const { client } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await assert.rejects(
    () => handleKeysCreate(1, { name: "k", type: "login", login: "admin" }, { json: true }, deps),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("--type login requires"));
      return true;
    },
  );
});

test("crea key none sin secret", async () => {
  const { client, getLastCreate } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await handleKeysCreate(1, { name: "no-secret", type: "none" }, { json: true }, deps);
  const call = getLastCreate();
  assert.ok(call, "create was called");
  assert.equal(call!.secret, undefined);
});

// ── handleKeysUpdate ──

test("actualiza solo el nombre de una key", async () => {
  const { client, getLastUpdate } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await handleKeysUpdate(1, 1, { name: "new-name" }, { json: false }, deps);
  const call = getLastUpdate();
  assert.ok(call, "update was called");
  assert.equal(call!.input.name, "new-name");
  assert.equal(call!.input.secret, undefined);
});

test("actualiza clave SSH con clave literal", async () => {
  const { client, getLastUpdate } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await handleKeysUpdate(1, 1, { privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----" }, { json: false }, deps);
  const call = getLastUpdate();
  assert.ok(call, "update was called");
  assert.equal(call!.input.secret?.privateKey, "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----");
});

test("actualiza clave SSH leyendo desde fichero", async () => {
  const { client, getLastUpdate } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  const fixturePath = path.resolve("tests/fixtures/test_key.pem");
  await handleKeysUpdate(1, 1, { privateKeyFile: fixturePath }, { json: false }, deps);
  const call = getLastUpdate();
  assert.ok(call, "update was called");
  const expected = fs.readFileSync(fixturePath, "utf8");
  assert.equal(call!.input.secret?.privateKey, expected);
});

test("actualiza credenciales login", async () => {
  const { client, getLastUpdate } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await handleKeysUpdate(1, 1, { login: "admin", password: "newpass" }, { json: false }, deps);
  const call = getLastUpdate();
  assert.ok(call, "update was called");
  assert.equal(call!.input.secret?.login, "admin");
  assert.equal(call!.input.secret?.password, "newpass");
});

test("rechaza actualización sin campos", async () => {
  const { client } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await assert.rejects(
    () => handleKeysUpdate(1, 1, {}, { json: false }, deps),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("No fields to update"));
      return true;
    },
  );
});

test("rechaza --private-key y --private-key-file simultáneos en update", async () => {
  const { client } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await assert.rejects(
    () => handleKeysUpdate(1, 1, { privateKey: "abc", privateKeyFile: "/some/path" }, { json: false }, deps),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("mutually exclusive"));
      return true;
    },
  );
});

test("rechaza fichero de clave inexistente en update", async () => {
  const { client } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await assert.rejects(
    () => handleKeysUpdate(1, 1, { privateKeyFile: "/nonexistent/key.pem" }, { json: false }, deps),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("key file not found"));
      return true;
    },
  );
});

test("rechaza clave SSH vacía en update", async () => {
  const { client } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await assert.rejects(
    () => handleKeysUpdate(1, 1, { privateKey: "   " }, { json: false }, deps),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("private key cannot be empty"));
      return true;
    },
  );
});

test("rechaza --login sin --password en update", async () => {
  const { client } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await assert.rejects(
    () => handleKeysUpdate(1, 1, { login: "admin" }, { json: false }, deps),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("must be provided together"));
      return true;
    },
  );
});

test("rechaza --password sin --login en update", async () => {
  const { client } = makeMockClient();
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  await assert.rejects(
    () => handleKeysUpdate(1, 1, { password: "pw" }, { json: false }, deps),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("must be provided together"));
      return true;
    },
  );
});
