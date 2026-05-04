import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { SemaphoreClient } from "../src/index.js";
import type { ProjectUser } from "../src/index.js";

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

const mockUsers: ProjectUser[] = [
  { id: 1, project_id: 10, name: "Alice", username: "alice", email: "alice@example.com", role: "owner" },
  { id: 2, project_id: 10, name: "Bob", username: "bob", email: "bob@example.com", role: "guest" },
];

// — list —

test("projects.users.list() retorna array de ProjectUser", async () => {
  const fm = mockFetch([{ status: 200, body: mockUsers }]);
  const result = await new SemaphoreClient(CONFIG).projects.users.list(10);
  assert.equal(result.length, 2);
  assert.equal(result[0].username, "alice");
  assert.equal(result[1].role, "guest");
  fm.mock.restore();
});

test("projects.users.list() retorna array vacío cuando no hay usuarios", async () => {
  const fm = mockFetch([{ status: 200, body: [] }]);
  const result = await new SemaphoreClient(CONFIG).projects.users.list(10);
  assert.deepEqual(result, []);
  fm.mock.restore();
});

test("projects.users.list() usa el endpoint correcto", async () => {
  let capturedUrl = "";
  const fm = mock.method(globalThis, "fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return { ok: true, status: 200, json: async () => [] } as Response;
  });
  await new SemaphoreClient(CONFIG).projects.users.list(42);
  assert.match(capturedUrl, /\/api\/project\/42\/users$/);
  fm.mock.restore();
});

// — add —

test("projects.users.add() retorna el ProjectUser creado", async () => {
  const newUser: ProjectUser = { id: 3, project_id: 10, name: "Carol", username: "carol", email: "carol@example.com", role: "manager" };
  const fm = mockFetch([{ status: 201, body: newUser }]);
  const result = await new SemaphoreClient(CONFIG).projects.users.add(10, { userId: 3, role: "manager" });
  assert.equal(result.username, "carol");
  assert.equal(result.role, "manager");
  fm.mock.restore();
});

test("projects.users.add() envía user_id y role en el body", async () => {
  let capturedBody: unknown;
  const fm = mock.method(globalThis, "fetch", async (_url: unknown, opts?: RequestInit) => {
    capturedBody = opts?.body ? JSON.parse(opts.body as string) : undefined;
    return { ok: true, status: 201, json: async () => ({ id: 3, project_id: 10, name: "Carol", username: "carol", email: "carol@example.com", role: "task_runner" }) } as Response;
  });
  await new SemaphoreClient(CONFIG).projects.users.add(10, { userId: 3, role: "task_runner" });
  const body = capturedBody as Record<string, unknown>;
  assert.equal(body.user_id, 3);
  assert.equal(body.role, "task_runner");
  fm.mock.restore();
});

// — update —

test("projects.users.update() devuelve undefined en 204", async () => {
  const fm = mockFetch([{ status: 204 }]);
  const result = await new SemaphoreClient(CONFIG).projects.users.update(10, 1, { role: "manager" });
  assert.equal(result, undefined);
  fm.mock.restore();
});

test("projects.users.update() envía user_id y role en el body", async () => {
  let capturedBody: unknown;
  const fm = mock.method(globalThis, "fetch", async (_url: unknown, opts?: RequestInit) => {
    capturedBody = opts?.body ? JSON.parse(opts.body as string) : undefined;
    return { ok: true, status: 204, text: async () => "" } as unknown as Response;
  });
  await new SemaphoreClient(CONFIG).projects.users.update(10, 1, { role: "manager" });
  const body = capturedBody as Record<string, unknown>;
  assert.equal(body.user_id, 1);
  assert.equal(body.role, "manager");
  fm.mock.restore();
});

test("projects.users.update() usa el endpoint correcto", async () => {
  let capturedUrl = "";
  const fm = mock.method(globalThis, "fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return { ok: true, status: 204, text: async () => "" } as unknown as Response;
  });
  await new SemaphoreClient(CONFIG).projects.users.update(10, 7, { role: "guest" });
  assert.match(capturedUrl, /\/api\/project\/10\/users\/7$/);
  fm.mock.restore();
});

// — remove —

test("projects.users.remove() devuelve undefined en 204", async () => {
  const fm = mockFetch([{ status: 204 }]);
  const result = await new SemaphoreClient(CONFIG).projects.users.remove(10, 1);
  assert.equal(result, undefined);
  fm.mock.restore();
});

test("projects.users.remove() usa DELETE en el endpoint correcto", async () => {
  let capturedUrl = "";
  let capturedMethod = "";
  const fm = mock.method(globalThis, "fetch", async (url: unknown, opts?: RequestInit) => {
    capturedUrl = String(url);
    capturedMethod = opts?.method ?? "GET";
    return { ok: true, status: 204, text: async () => "" } as unknown as Response;
  });
  await new SemaphoreClient(CONFIG).projects.users.remove(10, 5);
  assert.match(capturedUrl, /\/api\/project\/10\/users\/5$/);
  assert.equal(capturedMethod, "DELETE");
  fm.mock.restore();
});
