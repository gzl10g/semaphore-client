import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { SemaphoreClient } from "../src/index.js";

const CONFIG = { baseUrl: "http://semaphore.test", apiToken: "test-token" };

type FakeResponse = { status: number; body?: unknown };

function mockFetch(responses: FakeResponse[]) {
  let i = 0;
  return mock.method(globalThis, "fetch", async () => {
    const r = responses[Math.min(i++, responses.length - 1)];
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

const VIEW = { id: 1, project_id: 10, title: "Deploy", position: 3 };

// — list —

test("views.list() devuelve array de views", async () => {
  const fm = mockFetch([{ status: 200, body: [VIEW] }]);
  const result = await new SemaphoreClient(CONFIG).views.list(10);
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "Deploy");
  fm.mock.restore();
});

// — get —

test("views.get() devuelve view por id", async () => {
  const fm = mockFetch([{ status: 200, body: VIEW }]);
  const result = await new SemaphoreClient(CONFIG).views.get(10, 1);
  assert.ok(result !== null);
  assert.equal(result.id, 1);
  assert.equal(result.title, "Deploy");
  fm.mock.restore();
});

test("views.get() devuelve null en 404", async () => {
  const fm = mockFetch([{ status: 404 }]);
  const result = await new SemaphoreClient(CONFIG).views.get(10, 999);
  assert.equal(result, null);
  fm.mock.restore();
});

test("views.get() relanza error en 500", async () => {
  const fm = mockFetch([{ status: 500 }]);
  await assert.rejects(() => new SemaphoreClient(CONFIG).views.get(10, 1));
  fm.mock.restore();
});

// — create —

test("views.create() envía POST con body correcto y devuelve View", async () => {
  let capturedBody: unknown;
  const fm = mock.method(globalThis, "fetch", async (_url: unknown, opts?: RequestInit) => {
    capturedBody = opts?.body ? JSON.parse(opts.body as string) : undefined;
    return { ok: true, status: 200, text: async () => JSON.stringify(VIEW), json: async () => VIEW } as Response;
  });
  const result = await new SemaphoreClient(CONFIG).views.create({
    projectId: 10,
    title: "Deploy",
    position: 0,
  });
  assert.equal(result.id, 1);
  assert.equal(result.title, "Deploy");
  const body = capturedBody as Record<string, unknown>;
  assert.equal(body.project_id, 10);
  assert.equal(body.title, "Deploy");
  assert.equal(body.position, 0);
  fm.mock.restore();
});

test("views.create() sin position no incluye el campo en el body", async () => {
  let capturedBody: unknown;
  const fm = mock.method(globalThis, "fetch", async (_url: unknown, opts?: RequestInit) => {
    capturedBody = opts?.body ? JSON.parse(opts.body as string) : undefined;
    return { ok: true, status: 200, text: async () => JSON.stringify(VIEW), json: async () => VIEW } as Response;
  });
  await new SemaphoreClient(CONFIG).views.create({ projectId: 10, title: "Deploy" });
  assert.ok(!Object.prototype.hasOwnProperty.call(capturedBody, "position"));
  fm.mock.restore();
});

// — update —

test("views.update() lee la view y manda el PUT completo", async () => {
  const calls: Array<{ method: string; body: Record<string, unknown> | undefined }> = [];
  const fm = mock.method(globalThis, "fetch", async (_url: unknown, opts?: RequestInit) => {
    calls.push({
      method: opts?.method ?? "GET",
      body: opts?.body ? (JSON.parse(opts.body as string) as Record<string, unknown>) : undefined,
    });
    if ((opts?.method ?? "GET") === "GET") {
      return { ok: true, status: 200, text: async () => JSON.stringify(VIEW), json: async () => VIEW } as Response;
    }
    return { ok: true, status: 204, text: async () => "", json: async () => null } as Response;
  });
  const result = await new SemaphoreClient(CONFIG).views.update(10, 1, { title: "Updated" });
  fm.mock.restore();

  assert.equal(result, undefined);
  assert.deepEqual(calls.map((c) => c.method), ["GET", "PUT"]);
  const body = calls[1]?.body as Record<string, unknown>;
  assert.equal(body["id"], 1);
  assert.equal(body["project_id"], 10);
  assert.equal(body["title"], "Updated");
  assert.equal(body["position"], 3, "la posición existente sobrevive al renombrado");
});

// — delete —

test("views.delete() envía DELETE y devuelve void", async () => {
  let capturedMethod: string | undefined;
  let capturedUrl: string = "";
  const fm = mock.method(globalThis, "fetch", async (url: unknown, opts?: RequestInit) => {
    capturedMethod = opts?.method;
    capturedUrl = String(url);
    return { ok: true, status: 204, text: async () => "", json: async () => null } as Response;
  });
  const result = await new SemaphoreClient(CONFIG).views.delete(10, 1);
  assert.equal(result, undefined);
  assert.equal(capturedMethod, "DELETE");
  assert.match(capturedUrl, /\/project\/10\/views\/1$/);
  fm.mock.restore();
});
