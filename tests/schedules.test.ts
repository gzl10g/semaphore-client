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
