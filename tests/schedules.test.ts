import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { SemaphoreClient } from "../src/index.js";

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

// The API sends `active`; it never sends `enabled`.
const RAW = {
  id: 2,
  project_id: 1,
  template_id: 13,
  cron_format: "0 * * * *",
  name: "",
  active: true,
  repository_id: null,
};

test("get() exposes the API's `active` as `enabled`", async () => {
  const f = mockFetch([{ status: 200, body: RAW }]);
  try {
    const client = new SemaphoreClient(CONFIG);
    const s = await client.schedules.get(1, 2);
    assert.equal(s?.enabled, true);
    assert.equal(s?.active, true);
  } finally {
    f.mock.restore();
  }
});

test("list() normalizes every schedule", async () => {
  const f = mockFetch([{ status: 200, body: [RAW, { ...RAW, id: 3, active: false }] }]);
  try {
    const client = new SemaphoreClient(CONFIG);
    const list = await client.schedules.list(1);
    assert.deepEqual(list.map((s) => s.enabled), [true, false]);
  } finally {
    f.mock.restore();
  }
});

test("a partial update keeps the schedule enabled (it used to pause it)", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 200, body: RAW }, { status: 204 }], captured);
  try {
    const client = new SemaphoreClient(CONFIG);
    await client.schedules.update(1, 2, { cronFormat: "0 */12 * * *" });
  } finally {
    f.mock.restore();
  }
  const put = captured.find((c) => c.method === "PUT");
  assert.ok(put, "a PUT must be sent");
  assert.equal(put.body?.["active"], true, "active must survive a partial update");
  assert.equal(put.body?.["cron_format"], "0 */12 * * *");
});

test("a partial update keeps template_id, which the PUT requires", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 200, body: RAW }, { status: 204 }], captured);
  try {
    const client = new SemaphoreClient(CONFIG);
    await client.schedules.update(1, 2, { enabled: false });
  } finally {
    f.mock.restore();
  }
  const put = captured.find((c) => c.method === "PUT");
  assert.equal(put?.body?.["template_id"], 13);
  assert.equal(put?.body?.["active"], false);
});

test("a null repository_id is not echoed back to the server", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 200, body: RAW }, { status: 204 }], captured);
  try {
    const client = new SemaphoreClient(CONFIG);
    await client.schedules.update(1, 2, { cronFormat: "5 * * * *" });
  } finally {
    f.mock.restore();
  }
  const put = captured.find((c) => c.method === "PUT");
  assert.ok(put && !("repository_id" in (put.body ?? {})));
});

test("an existing repository_id is preserved", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 200, body: { ...RAW, repository_id: 7 } }, { status: 204 }], captured);
  try {
    const client = new SemaphoreClient(CONFIG);
    await client.schedules.update(1, 2, { cronFormat: "5 * * * *" });
  } finally {
    f.mock.restore();
  }
  assert.equal(captured.find((c) => c.method === "PUT")?.body?.["repository_id"], 7);
});

test("updating a schedule that does not exist fails as 404", async () => {
  const f = mockFetch([{ status: 404 }]);
  try {
    const client = new SemaphoreClient(CONFIG);
    await assert.rejects(() => client.schedules.update(1, 999, { enabled: true }), /404/);
  } finally {
    f.mock.restore();
  }
});

// — P2: el tipo sigue al campo que llega; P10: task_params por clave —

test("update() with only runAt turns a cron schedule into a one-shot one, and only cronFormat back", async () => {
  for (const [input, type] of [[{ runAt: "2030-01-01T00:00:00Z" }, "run_at"], [{ cronFormat: "0 4 * * *" }, ""]] as const) {
    const captured: Captured[] = [];
    const f = mockFetch([{ status: 200, body: { ...RAW, type: type === "" ? "run_at" : "" } }, { status: 204 }], captured);
    try {
      await new SemaphoreClient(CONFIG).schedules.update(1, 2, input);
    } finally {
      f.mock.restore();
    }
    assert.equal(captured[1]?.body?.["type"], type, JSON.stringify(input));
  }
});

test("update() that touches neither cron nor run_at keeps the stored type", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 200, body: { ...RAW, type: "" } }, { status: 204 }], captured);
  try {
    await new SemaphoreClient(CONFIG).schedules.update(1, 2, { name: "x" });
  } finally {
    f.mock.restore();
  }
  assert.equal(captured[1]?.body?.["type"], "", "an update that does not touch cron/run_at keeps the type");
});

test("update() merges taskParams key by key, params too", async () => {
  const captured: Captured[] = [];
  const existing = { ...RAW, task_params: { message: "m", params: { tags: ["a"], limit: ["old"] } } };
  const f = mockFetch([{ status: 200, body: existing }, { status: 204 }], captured);
  try {
    await new SemaphoreClient(CONFIG).schedules.update(1, 2, { taskParams: { params: { limit: ["web"] } } });
  } finally {
    f.mock.restore();
  }
  assert.deepEqual(captured[1]?.body?.["task_params"], { message: "m", params: { tags: ["a"], limit: ["web"] } });
});

test("update() without taskParams re-sends the stored ones: the server would unlink them otherwise", async () => {
  const captured: Captured[] = [];
  const existing = { ...RAW, task_params: { params: { tags: ["a"] } } };
  const f = mockFetch([{ status: 200, body: existing }, { status: 204 }], captured);
  try {
    await new SemaphoreClient(CONFIG).schedules.update(1, 2, { name: "renamed" });
  } finally {
    f.mock.restore();
  }
  assert.deepEqual(captured[1]?.body?.["task_params"], { params: { tags: ["a"] } });
});

test("create() sends taskParams", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 201, body: RAW }], captured);
  try {
    await new SemaphoreClient(CONFIG).schedules.create({ projectId: 1, templateId: 13, cronFormat: "0 * * * *", taskParams: { params: { limit: ["web"] } } });
  } finally {
    f.mock.restore();
  }
  assert.deepEqual(captured[0]?.body?.["task_params"], { params: { limit: ["web"] } });
});

test("mergeTaskParams ignores undefined keys, like mergeForUpdate, and keeps null (review B#2)", async () => {
  const { mergeTaskParams } = await import("../src/resources/schedules.js");
  assert.deepEqual(
    mergeTaskParams({ message: "m", inventory_id: 3, params: { tags: ["a"], limit: ["old"] } }, { message: undefined, params: { limit: ["web"], tags: undefined } }),
    { message: "m", inventory_id: 3, params: { tags: ["a"], limit: ["web"] } },
  );
  assert.deepEqual(mergeTaskParams({ params: { limit: ["old"] } }, { params: { limit: null } }), { params: { limit: null } });
});
