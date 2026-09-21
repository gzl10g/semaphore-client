import { test } from "node:test";
import assert from "node:assert/strict";
import type { SemaphoreClient } from "../../src/client.js";
import {
  handleIntegrationsList,
  handleIntegrationsGet,
  handleIntegrationsCreate,
  handleIntegrationsUpdate,
  handleMatchersCreate,
  handleValuesCreate,
  handleAliasesCreate,
  handleIntegrationsDelete,
  handleAliasesDelete,
  handleMatchersUpdate,
  handleValuesUpdate,
} from "../../src/cli/integrations.js";

const MOCK_INTEGRATION = {
  id: 7,
  name: "deploy hook",
  project_id: 2,
  template_id: 13,
  auth_method: "",
  auth_header: "",
  searchable: false,
};

const DEPS_CONFIG = {
  version: 1 as const,
  host: "http://x",
  token: "t",
  activeProject: 2,
};

function buildDeps(overrides: Record<string, unknown> = {}) {
  const calls: { update: unknown[]; create: unknown[]; deleted: unknown[] } = {
    update: [],
    create: [],
    deleted: [],
  };
  const integration = { ...MOCK_INTEGRATION, ...overrides };
  const client = {
    integrations: {
      list: async () => [integration],
      get: async (_p: number, id: number) => (id === 7 ? integration : null),
      create: async (input: unknown) => {
        calls.create.push(input);
        return integration;
      },
      update: async (...args: unknown[]) => {
        calls.update.push(args);
      },
      matchers: {
        create: async () => ({ id: 3, integration_id: 7, name: "m" }),
        update: async () => {},
      },
      values: {
        create: async () => ({ id: 5, integration_id: 7, name: "v" }),
        update: async () => {},
      },
      aliases: {
        create: async () => ({ id: 11, url: "/api/integrations/abc", alias: "abc" }),
        delete: async (...args: unknown[]) => {
          calls.deleted.push(args);
        },
      },
      delete: async (...args: unknown[]) => {
        calls.deleted.push(args);
      },
    },
  } as unknown as SemaphoreClient;
  return { deps: { client, config: DEPS_CONFIG }, calls };
}

function capture(): { out: string[]; err: string[]; restore: () => void } {
  const out: string[] = [];
  const err: string[] = [];
  const originalLog = console.log;
  const originalErr = console.error;
  console.log = (...args: unknown[]) => out.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => err.push(args.map(String).join(" "));
  return {
    out,
    err,
    restore: () => {
      console.log = originalLog;
      console.error = originalErr;
    },
  };
}

test("handleIntegrationsList shows the searchable flag", async () => {
  const { deps } = buildDeps();
  const cap = capture();
  try {
    await handleIntegrationsList(2, { json: false }, deps);
  } finally {
    cap.restore();
  }
  const output = cap.out.join("\n");
  assert.ok(output.includes("Searchable"), `Expected the Searchable column:\n${output}`);
});

test("handleIntegrationsGet throws for an unknown id", async () => {
  const { deps } = buildDeps();
  const cap = capture();
  try {
    await assert.rejects(
      () => handleIntegrationsGet(2, 99, { json: false }, deps),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /not found/);
        return true;
      },
    );
  } finally {
    cap.restore();
  }
});

// An auth method with no key behind it is not "almost configured": the receiver
// compares against an empty secret and drops every request without a word.
test("handleIntegrationsCreate refuses an auth method with no secret", async () => {
  const { deps } = buildDeps();
  const cap = capture();
  try {
    await assert.rejects(
      () =>
        handleIntegrationsCreate(
          2,
          { name: "hook", templateId: 13, authMethod: "token", authHeader: "X-Token" },
          { json: false },
          deps,
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /--auth-secret-id/);
        return true;
      },
    );
  } finally {
    cap.restore();
  }
});

test("handleIntegrationsCreate refuses token auth with no header to read", async () => {
  const { deps } = buildDeps();
  const cap = capture();
  try {
    await assert.rejects(
      () =>
        handleIntegrationsCreate(
          2,
          { name: "hook", templateId: 13, authMethod: "token", authSecretId: 4 },
          { json: false },
          deps,
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /--auth-header/);
        return true;
      },
    );
  } finally {
    cap.restore();
  }
});

test("handleIntegrationsCreate lets the open endpoint through", async () => {
  const { deps, calls } = buildDeps();
  const cap = capture();
  try {
    await handleIntegrationsCreate(2, { name: "hook", templateId: 13 }, { json: true }, deps);
  } finally {
    cap.restore();
  }
  assert.equal(calls.create.length, 1);
  assert.deepEqual(calls.create[0], { name: "hook", templateId: 13, projectId: 2 });
});

test("handleIntegrationsUpdate delegates the merge to the resource", async () => {
  const { deps, calls } = buildDeps();
  const cap = capture();
  try {
    await handleIntegrationsUpdate(2, 7, { name: "renamed" }, { json: false }, deps);
  } finally {
    cap.restore();
  }
  assert.deepEqual(calls.update[0], [2, 7, { name: "renamed" }]);
});

test("handleValuesCreate refuses a header source with no key", async () => {
  const { deps } = buildDeps();
  const cap = capture();
  try {
    await assert.rejects(
      () =>
        handleValuesCreate(
          2,
          7,
          { name: "v", valueSource: "header", variable: "V", variableType: "environment" },
          { json: false },
          deps,
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /--key/);
        return true;
      },
    );
  } finally {
    cap.restore();
  }
});

test("handleValuesCreate refuses a JSON body source with no key", async () => {
  const { deps } = buildDeps();
  const cap = capture();
  try {
    await assert.rejects(
      () =>
        handleValuesCreate(
          2,
          7,
          { name: "v", valueSource: "body", variable: "V", variableType: "task" },
          { json: false },
          deps,
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /--key/);
        return true;
      },
    );
  } finally {
    cap.restore();
  }
});

test("handleValuesCreate accepts a whole-string body with no key", async () => {
  const { deps } = buildDeps();
  const cap = capture();
  try {
    await handleValuesCreate(
      2,
      7,
      {
        name: "v",
        valueSource: "body",
        bodyDataType: "string",
        variable: "V",
        variableType: "environment",
      },
      { json: true },
      deps,
    );
  } finally {
    cap.restore();
  }
  assert.ok(cap.out.join("\n").includes('"id": 5'));
});

// The two dead-end setups the server never complains about.
test("an alias on a searchable integration is flagged as dead", async () => {
  const { deps } = buildDeps({ searchable: true });
  const cap = capture();
  try {
    await handleAliasesCreate(2, 7, { json: true }, deps);
  } finally {
    cap.restore();
  }
  assert.match(cap.err.join("\n"), /never fire it/);
  // Parsed, not substring-matched: a warning moved to stdout would still
  // contain the substring while breaking `smphe ... --json | jq`.
  assert.deepEqual(JSON.parse(cap.out.join("\n")), {
    id: 11,
    url: "/api/integrations/abc",
    alias: "abc",
  });
});

test("an alias on a non-searchable integration passes without noise", async () => {
  const { deps } = buildDeps({ searchable: false });
  const cap = capture();
  try {
    await handleAliasesCreate(2, 7, { json: true }, deps);
  } finally {
    cap.restore();
  }
  assert.equal(cap.err.join("\n"), "");
});

test("a matcher on a non-searchable integration is flagged as ignored", async () => {
  const { deps } = buildDeps({ searchable: false });
  const cap = capture();
  try {
    await handleMatchersCreate(
      2,
      7,
      { name: "m", matchType: "header", method: "equals", key: "K", value: "V" },
      { json: true },
      deps,
    );
  } finally {
    cap.restore();
  }
  assert.match(cap.err.join("\n"), /never evaluated/);
  assert.deepEqual(JSON.parse(cap.out.join("\n")), { id: 3, integration_id: 7, name: "m" });
});

test("a matcher on a searchable integration passes without noise", async () => {
  const { deps } = buildDeps({ searchable: true });
  const cap = capture();
  try {
    await handleMatchersCreate(
      2,
      7,
      { name: "m", matchType: "header", method: "equals", key: "K", value: "V" },
      { json: true },
      deps,
    );
  } finally {
    cap.restore();
  }
  assert.equal(cap.err.join("\n"), "");
});

// ── the guards must let the valid combinations through ──

test("handleIntegrationsCreate accepts the three shapes the server supports", async () => {
  const { deps, calls } = buildDeps();
  const cap = capture();
  try {
    // The normal authenticated case.
    await handleIntegrationsCreate(
      2,
      { name: "a", templateId: 13, authMethod: "token", authSecretId: 4, authHeader: "X-T" },
      { json: true },
      deps,
    );
    // basic auth carries its credentials in the standard header, so the
    // --auth-header guard is deliberately token/hmac only.
    await handleIntegrationsCreate(
      2,
      { name: "b", templateId: 13, authMethod: "basic", authSecretId: 4 },
      { json: true },
      deps,
    );
    // `--auth-method none` maps to "", which needs no secret at all.
    await handleIntegrationsCreate(
      2,
      { name: "c", templateId: 13, authMethod: "" },
      { json: true },
      deps,
    );
  } finally {
    cap.restore();
  }
  assert.equal(calls.create.length, 3);
});

test("handleValuesCreate accepts the sources that carry their key", async () => {
  const { deps } = buildDeps();
  const cap = capture();
  try {
    await handleValuesCreate(
      2,
      7,
      { name: "h", valueSource: "header", key: "X-D", variable: "V", variableType: "task" },
      { json: true },
      deps,
    );
    await handleValuesCreate(
      2,
      7,
      { name: "b", valueSource: "body", key: "ref", variable: "V", variableType: "environment" },
      { json: true },
      deps,
    );
  } finally {
    cap.restore();
  }
  assert.equal(cap.err.join("\n"), "");
});

// ── deletes ──

// Inverting the `!opts.yes` guard would block every --yes delete on stdin in CI
// and fire every interactive one without asking.
test("--yes deletes without asking, and reports what it deleted", async () => {
  const { deps, calls } = buildDeps();
  const cap = capture();
  try {
    await handleIntegrationsDelete(2, 7, { yes: true }, deps);
    await handleAliasesDelete(2, 11, 7, { yes: true }, deps);
  } finally {
    cap.restore();
  }
  assert.deepEqual(calls.deleted, [
    [2, 7],
    [2, 11, 7],
  ]);
  assert.match(cap.out.join("\n"), /Integration 7 deleted/);
  assert.match(cap.out.join("\n"), /Alias 11 deleted/);
});

// The warning runs AFTER the server already created the alias, so a failing
// read must not turn a success into `Error:` and exit 1.
test("a warning whose read fails does not fail the command", async () => {
  const { deps } = buildDeps();
  (deps.client as unknown as { integrations: { get: () => Promise<never> } }).integrations.get =
    async () => {
      throw new Error("500 from the server");
    };
  const cap = capture();
  try {
    await handleAliasesCreate(2, 7, { json: true }, deps);
  } finally {
    cap.restore();
  }
  assert.deepEqual(JSON.parse(cap.out.join("\n")), {
    id: 11,
    url: "/api/integrations/abc",
    alias: "abc",
  });
  assert.equal(cap.err.join("\n"), "");
});

// `Integration 7 updated` no es JSON: con --json rompía a cualquiera que
// tuviese la salida enchufada a jq. Las tres mutaciones pasan por
// reportMutation, así que la confirmación sale parseable.
test("las mutaciones respetan el contrato --json", async () => {
  const { deps } = buildDeps();
  for (const [run, expected] of [
    [() => handleIntegrationsUpdate(2, 7, { name: "x" }, { json: true }, deps), "Integration 7 updated"],
    [() => handleMatchersUpdate(2, 7, 3, { value: "x" }, { json: true }, deps), "Matcher 3 updated"],
    [() => handleValuesUpdate(2, 7, 5, { variable: "X" }, { json: true }, deps), "Extract value 5 updated"],
  ] as const) {
    const cap = capture();
    try {
      await run();
    } finally {
      cap.restore();
    }
    const parsed = JSON.parse(cap.out.join("\n")) as Record<string, unknown>;
    assert.equal(parsed["ok"], true);
    assert.equal(parsed["message"], expected);
  }
});

test("sin --json la mutación sigue imprimiendo la frase de siempre", async () => {
  const { deps } = buildDeps();
  const cap = capture();
  try {
    await handleIntegrationsUpdate(2, 7, { name: "x" }, { json: false }, deps);
  } finally {
    cap.restore();
  }
  assert.equal(cap.out.join("\n"), "Integration 7 updated");
});
