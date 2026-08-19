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

const BACKUP = { meta: { name: "Homelab" }, templates: [{ name: "Deploy vega" }] };

test("backup.export() lee /project/{id}/backup", async () => {
  const cap: Captured[] = [];
  const fm = mockFetch([{ status: 200, body: BACKUP }], cap);
  const result = await new SemaphoreClient(CONFIG).backup.export(10);
  assert.equal(cap[0]?.method, "GET");
  assert.match(cap[0]?.url ?? "", /\/api\/project\/10\/backup$/);
  assert.deepEqual(result.meta, { name: "Homelab" });
  fm.mock.restore();
});

// restore NO cuelga del proyecto: crea uno nuevo, por eso la ruta es global.
test("backup.restore() hace POST a /projects/restore con el documento entero", async () => {
  const cap: Captured[] = [];
  const fm = mockFetch([{ status: 201, body: { id: 42, name: "Homelab" } }], cap);
  const project = await new SemaphoreClient(CONFIG).backup.restore(BACKUP);
  assert.equal(cap[0]?.method, "POST");
  assert.match(cap[0]?.url ?? "", /\/api\/projects\/restore$/);
  assert.deepEqual(cap[0]?.body?.["meta"], { name: "Homelab" });
  assert.equal(project.id, 42);
  fm.mock.restore();
});
