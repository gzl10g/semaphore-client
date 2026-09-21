import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { SemaphoreClient, SemaphoreApiError } from "../src/index.js";

const CONFIG = { baseUrl: "http://semaphore.test", apiToken: "test-token" };

type FakeResponse = { status: number; body?: unknown };
type Captured = { url: string; method: string; body: Record<string, unknown> | undefined };

function mockFetch(responses: FakeResponse[], captured: Captured[] = []) {
  let i = 0;
  return mock.method(globalThis, "fetch", async (url: unknown, init: unknown) => {
    const opts = (init ?? {}) as { method?: string; body?: string };
    captured.push({
      url: String(url),
      method: opts.method ?? "GET",
      body: opts.body ? (JSON.parse(opts.body) as Record<string, unknown>) : undefined,
    });
    const r = responses[Math.min(i++, responses.length - 1)] as FakeResponse;
    const text = r.body !== undefined ? JSON.stringify(r.body) : "";
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: String(r.status),
      text: async () => text,
      json: async () => (text ? JSON.parse(text) : null),
    } as Response;
  });
}

const INTEGRATION = {
  id: 7,
  name: "deploy hook",
  project_id: 2,
  template_id: 13,
  auth_method: "token",
  auth_secret_id: 4,
  auth_header: "X-Deploy-Token",
  searchable: false,
  task_params: { message: "from github", params: { ref: "main" } },
};

// ── integrations ──

test("get() returns null on 404 and the integration otherwise", async () => {
  const f = mockFetch([{ status: 404, body: { error: "not found" } }]);
  try {
    const client = new SemaphoreClient(CONFIG);
    assert.equal(await client.integrations.get(2, 7), null);
  } finally {
    f.mock.restore();
  }

  const g = mockFetch([{ status: 200, body: INTEGRATION }]);
  try {
    const client = new SemaphoreClient(CONFIG);
    assert.equal((await client.integrations.get(2, 7))?.name, "deploy hook");
  } finally {
    g.mock.restore();
  }
});

test("create() maps camelCase input to the API's snake_case and echoes project_id", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 201, body: INTEGRATION }], captured);
  try {
    const client = new SemaphoreClient(CONFIG);
    await client.integrations.create({
      projectId: 2,
      name: "deploy hook",
      templateId: 13,
      authMethod: "token",
      authSecretId: 4,
      authHeader: "X-Deploy-Token",
      searchable: true,
    });
  } finally {
    f.mock.restore();
  }

  const req = captured[0] as Captured;
  assert.equal(req.method, "POST");
  assert.ok(req.url.endsWith("/api/project/2/integrations"));
  // The server rejects a body whose project_id does not match the URL.
  assert.deepEqual(req.body, {
    project_id: 2,
    name: "deploy hook",
    template_id: 13,
    auth_method: "token",
    auth_header: "X-Deploy-Token",
    auth_secret_id: 4,
    searchable: true,
  });
});

test("create() defaults to the open endpoint instead of leaving auth undefined", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 201, body: INTEGRATION }], captured);
  try {
    const client = new SemaphoreClient(CONFIG);
    await client.integrations.create({ projectId: 2, name: "hook", templateId: 13 });
  } finally {
    f.mock.restore();
  }

  assert.equal((captured[0] as Captured).body?.["auth_method"], "");
  assert.equal((captured[0] as Captured).body?.["auth_header"], "");
});

// This is the regression the whole read-merge-write exists for: the server's
// PUT binds a zero struct, so anything the body omits is persisted as its zero
// value — renaming would clear the auth and the task params.
test("update() re-sends the whole integration, changing only what was asked", async () => {
  const captured: Captured[] = [];
  const f = mockFetch(
    [
      { status: 200, body: INTEGRATION },
      { status: 204 },
    ],
    captured,
  );
  try {
    const client = new SemaphoreClient(CONFIG);
    await client.integrations.update(2, 7, { name: "renamed" });
  } finally {
    f.mock.restore();
  }

  assert.equal(captured.length, 2);
  assert.equal((captured[0] as Captured).method, "GET");
  const put = captured[1] as Captured;
  assert.equal(put.method, "PUT");
  assert.deepEqual(put.body, { ...INTEGRATION, name: "renamed" });
});

test("update() keeps `searchable: false` instead of dropping the flag", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 200, body: INTEGRATION }, { status: 204 }], captured);
  try {
    const client = new SemaphoreClient(CONFIG);
    await client.integrations.update(2, 7, { templateId: 99 });
  } finally {
    f.mock.restore();
  }

  const put = (captured[1] as Captured).body as Record<string, unknown>;
  assert.equal(put["searchable"], false);
  assert.equal(put["template_id"], 99);
  assert.deepEqual(put["task_params"], INTEGRATION.task_params);
});

test("update() reports the integration as not found when the read 404s", async () => {
  const f = mockFetch([{ status: 404, body: { error: "not found" } }]);
  try {
    await assert.rejects(
      () => new SemaphoreClient(CONFIG).integrations.update(2, 7, { name: "x" }),
      (err: unknown) => {
        assert.ok(err instanceof SemaphoreApiError);
        assert.equal(err.status, 404);
        assert.match(String(err.message), /Integration 7 not found/);
        return true;
      },
    );
  } finally {
    f.mock.restore();
  }
});

// ── matchers ──

// No `id` here on purpose: if the fixture carried one, the merge would copy it
// into the body and the assertion below could not tell whether `update()`
// actually sends it.
const MATCHER = {
  integration_id: 7,
  name: "only main",
  match_type: "body",
  method: "equals",
  body_data_type: "json",
  key: "ref",
  value: "refs/heads/main",
};

test("matchers.create() defaults body_data_type by match type", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 200, body: MATCHER }], captured);
  try {
    const client = new SemaphoreClient(CONFIG);
    await client.integrations.matchers.create(2, 7, {
      name: "only main",
      matchType: "body",
      method: "equals",
      key: "ref",
      value: "refs/heads/main",
    });
    await client.integrations.matchers.create(2, 7, {
      name: "from github",
      matchType: "header",
      method: "contains",
      key: "User-Agent",
      value: "GitHub",
    });
  } finally {
    f.mock.restore();
  }

  assert.equal((captured[0] as Captured).body?.["body_data_type"], "json");
  assert.equal((captured[1] as Captured).body?.["body_data_type"], "");
  assert.equal((captured[0] as Captured).body?.["integration_id"], 7);
});

/**
 * `UpdateIntegrationMatcher` binds into a zero struct and then updates the row
 * named by `matcher.ID` in the *body*, never comparing it with the URL. A body
 * without `id` therefore answers 204 having changed nothing.
 */
test("matchers.update() sends the id and the untouched fields", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 200, body: MATCHER }, { status: 204 }], captured);
  try {
    const client = new SemaphoreClient(CONFIG);
    await client.integrations.matchers.update(2, 7, 3, { value: "refs/heads/prod" });
  } finally {
    f.mock.restore();
  }

  const put = captured[1] as Captured;
  assert.ok(put.url.endsWith("/api/project/2/integrations/7/matchers/3"));
  // The whole point: the server's UPDATE is `where integration_id=? and id=?`
  // taking BOTH from the body. Without this, the PUT answers 204 having
  // matched no row at all.
  assert.equal(put.body?.["id"], 3);
  assert.deepEqual(put.body, { ...MATCHER, id: 3, value: "refs/heads/prod" });
  assert.equal(captured.length, 2);
});

// ── extract values ──

const VALUE = {
  id: 5,
  integration_id: 7,
  name: "branch",
  value_source: "body",
  body_data_type: "json",
  key: "ref",
  variable: "BRANCH",
  variable_type: "environment",
};

test("values.create() maps the input and defaults the body data type", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 201, body: VALUE }], captured);
  try {
    const client = new SemaphoreClient(CONFIG);
    await client.integrations.values.create(2, 7, {
      name: "branch",
      valueSource: "body",
      key: "ref",
      variable: "BRANCH",
      variableType: "environment",
    });
  } finally {
    f.mock.restore();
  }

  assert.deepEqual((captured[0] as Captured).body, {
    integration_id: 7,
    name: "branch",
    value_source: "body",
    body_data_type: "json",
    key: "ref",
    variable: "BRANCH",
    variable_type: "environment",
  });
});

test("values.update() merges instead of sending a partial body", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 200, body: VALUE }, { status: 204 }], captured);
  try {
    const client = new SemaphoreClient(CONFIG);
    await client.integrations.values.update(2, 7, 5, { variable: "GIT_REF" });
  } finally {
    f.mock.restore();
  }

  assert.deepEqual((captured[1] as Captured).body, { ...VALUE, variable: "GIT_REF" });
  assert.equal(captured.length, 2);
});

// ── aliases ──

test("aliases expose the alias string the server hides", async () => {
  const f = mockFetch([
    {
      status: 200,
      body: [{ id: 11, url: "https://semaphore.test/api/integrations/Ab12Cd34Ef56Gh78" }],
    },
  ]);
  let aliases;
  try {
    const client = new SemaphoreClient(CONFIG);
    aliases = await client.integrations.aliases.list(2, 7);
  } finally {
    f.mock.restore();
  }

  assert.equal(aliases[0]?.alias, "Ab12Cd34Ef56Gh78");
  assert.equal(aliases[0]?.id, 11);
});

// Without this, `list()` could ignore its argument and start reporting every
// alias in the project as if it belonged to the integration.
test("aliases.list() picks the project or the integration route", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 200, body: [] }], captured);
  try {
    const client = new SemaphoreClient(CONFIG);
    await client.integrations.aliases.list(2, 7);
    await client.integrations.aliases.list(2);
  } finally {
    f.mock.restore();
  }

  assert.ok((captured[0] as Captured).url.endsWith("/api/project/2/integrations/7/aliases"));
  assert.ok((captured[1] as Captured).url.endsWith("/api/project/2/integrations/aliases"));
});

// `web_host` unset makes the server return a relative URL; the alias is still
// the last segment, and that is the part a webhook caller needs.
test("aliases read the alias out of a relative URL too", async () => {
  const f = mockFetch([{ status: 200, body: { id: 12, url: "/api/integrations/zzz999" } }]);
  let alias;
  try {
    const client = new SemaphoreClient(CONFIG);
    alias = await client.integrations.aliases.create(2);
  } finally {
    f.mock.restore();
  }

  assert.equal(alias.alias, "zzz999");
});

test("aliases pick the project or the integration route by argument", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 200, body: { id: 1, url: "/api/integrations/a" } }], captured);
  try {
    const client = new SemaphoreClient(CONFIG);
    await client.integrations.aliases.create(2);
    await client.integrations.aliases.create(2, 7);
    await client.integrations.aliases.delete(2, 11);
    await client.integrations.aliases.delete(2, 11, 7);
  } finally {
    f.mock.restore();
  }

  assert.ok((captured[0] as Captured).url.endsWith("/api/project/2/integrations/aliases"));
  assert.ok((captured[1] as Captured).url.endsWith("/api/project/2/integrations/7/aliases"));
  assert.ok((captured[2] as Captured).url.endsWith("/api/project/2/integrations/aliases/11"));
  assert.ok((captured[3] as Captured).url.endsWith("/api/project/2/integrations/7/aliases/11"));
  assert.equal((captured[2] as Captured).method, "DELETE");
});

test("refs hang off the right endpoints", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 200, body: { matchers: [], values: [] } }], captured);
  try {
    const client = new SemaphoreClient(CONFIG);
    await client.integrations.refs(2, 7);
    await client.integrations.matchers.refs(2, 7, 3);
    await client.integrations.values.refs(2, 7, 5);
  } finally {
    f.mock.restore();
  }

  assert.ok((captured[0] as Captured).url.endsWith("/api/project/2/integrations/7/refs"));
  assert.ok((captured[1] as Captured).url.endsWith("/api/project/2/integrations/7/matchers/3/refs"));
  assert.ok((captured[2] as Captured).url.endsWith("/api/project/2/integrations/7/values/5/refs"));
});

// ── error paths ──

// A `catch { return null }` would turn a 500, or the empty-bodied 403 this
// server sends, into "not found" — and the user deletes and recreates an
// object that exists and that they simply cannot read.
test("get() re-throws anything that is not a 404", async () => {
  for (const call of [
    (c: SemaphoreClient) => c.integrations.get(2, 7),
    (c: SemaphoreClient) => c.integrations.matchers.get(2, 7, 3),
    (c: SemaphoreClient) => c.integrations.values.get(2, 7, 5),
  ]) {
    const f = mockFetch([{ status: 500, body: { error: "boom" } }]);
    try {
      await assert.rejects(() => call(new SemaphoreClient(CONFIG)), SemaphoreApiError);
    } finally {
      f.mock.restore();
    }
  }
});

test("matchers.get() and values.get() return the object, and null on 404", async () => {
  const f = mockFetch([{ status: 200, body: { ...MATCHER, id: 3 } }]);
  try {
    const client = new SemaphoreClient(CONFIG);
    assert.equal((await client.integrations.matchers.get(2, 7, 3))?.name, "only main");
  } finally {
    f.mock.restore();
  }

  const g = mockFetch([{ status: 200, body: VALUE }]);
  try {
    const client = new SemaphoreClient(CONFIG);
    assert.equal((await client.integrations.values.get(2, 7, 5))?.variable, "BRANCH");
  } finally {
    g.mock.restore();
  }

  const h = mockFetch([{ status: 404, body: { error: "not found" } }]);
  try {
    const client = new SemaphoreClient(CONFIG);
    assert.equal(await client.integrations.matchers.get(2, 7, 3), null);
    assert.equal(await client.integrations.values.get(2, 7, 5), null);
  } finally {
    h.mock.restore();
  }
});

// A copy-pasted label sends the user to check the wrong object.
test("a nested update names the object that is missing, not its parent", async () => {
  for (const [call, expected] of [
    [(c: SemaphoreClient) => c.integrations.matchers.update(2, 7, 3, { value: "x" }), /Integration matcher 3 not found/],
    [(c: SemaphoreClient) => c.integrations.values.update(2, 7, 5, { variable: "X" }), /Integration extract value 5 not found/],
  ] as const) {
    const f = mockFetch([{ status: 404, body: { error: "not found" } }]);
    try {
      await assert.rejects(() => call(new SemaphoreClient(CONFIG)), (err: unknown) => {
        assert.ok(err instanceof SemaphoreApiError);
        assert.match(String(err.message), expected);
        return true;
      });
    } finally {
      f.mock.restore();
    }
  }
});

// ── the auth guard ──

// The server stores an auth method with no secret and then drops every webhook
// call in silence, so the client refuses to build that state at all.
test("create() refuses an auth method with no key behind it", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 201, body: INTEGRATION }], captured);
  try {
    await assert.rejects(
      () =>
        new SemaphoreClient(CONFIG).integrations.create({
          projectId: 2,
          name: "hook",
          templateId: 13,
          authMethod: "hmac",
        }),
      (err: unknown) => {
        assert.ok(err instanceof SemaphoreApiError);
        assert.match(String(err.message), /needs a key holding its secret/);
        return true;
      },
    );
  } finally {
    f.mock.restore();
  }
  // And it never reached the wire.
  assert.equal(captured.length, 0);
});

test("update() refuses to arm an auth method the integration has no key for", async () => {
  const captured: Captured[] = [];
  const open = { ...INTEGRATION, auth_method: "", auth_secret_id: null, auth_header: "" };
  const f = mockFetch([{ status: 200, body: open }, { status: 204 }], captured);
  try {
    await assert.rejects(
      () => new SemaphoreClient(CONFIG).integrations.update(2, 7, { authMethod: "hmac" }),
      SemaphoreApiError,
    );
  } finally {
    f.mock.restore();
  }
  // The GET happened; the PUT did not.
  assert.equal(captured.length, 1);
});

test("update() accepts an auth method whose key comes from the stored state", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 200, body: INTEGRATION }, { status: 204 }], captured);
  try {
    await new SemaphoreClient(CONFIG).integrations.update(2, 7, { authMethod: "hmac" });
  } finally {
    f.mock.restore();
  }
  assert.equal((captured[1] as Captured).body?.["auth_method"], "hmac");
  assert.equal((captured[1] as Captured).body?.["auth_secret_id"], 4);
});

// Detaching the key is legitimate as long as the method goes with it.
test("update() lets an integration be turned back into an open endpoint", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 200, body: INTEGRATION }, { status: 204 }], captured);
  try {
    await new SemaphoreClient(CONFIG).integrations.update(2, 7, {
      authMethod: "",
      authSecretId: null,
    });
  } finally {
    f.mock.restore();
  }
  assert.equal((captured[1] as Captured).body?.["auth_method"], "");
  assert.equal((captured[1] as Captured).body?.["auth_secret_id"], null);
});

test("create() passes task_params through", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 201, body: INTEGRATION }], captured);
  try {
    await new SemaphoreClient(CONFIG).integrations.create({
      projectId: 2,
      name: "hook",
      templateId: 13,
      taskParams: { message: "from github", inventory_id: 9 },
    });
  } finally {
    f.mock.restore();
  }
  assert.deepEqual((captured[0] as Captured).body?.["task_params"], {
    message: "from github",
    inventory_id: 9,
  });
});
