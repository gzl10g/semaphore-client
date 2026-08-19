import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { SemaphoreClient } from "../src/index.js";
import { SemaphoreApiError } from "../src/error.js";

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

// Hace que setTimeout sea inmediato para que los retries no tarden
function mockInstantRetry() {
  return mock.method(globalThis, "setTimeout", (fn: TimerHandler) => {
    if (typeof fn === "function") fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });
}

// — ping —

test("ping returns true on any HTTP response", async () => {
  const fm = mockFetch([{ status: 200 }]);
  assert.ok(await new SemaphoreClient(CONFIG).ping());
  fm.mock.restore();
});

test("ping returns false on network error", async () => {
  const fm = mock.method(globalThis, "fetch", async () => { throw new Error("ECONNREFUSED"); });
  assert.ok(!await new SemaphoreClient(CONFIG).ping());
  fm.mock.restore();
});

// — retry —

test("retries on configured status codes up to maxRetries", async () => {
  const tm = mockInstantRetry();
  let calls = 0;
  const fm = mock.method(globalThis, "fetch", async () => {
    calls++;
    return { ok: false, status: 503, statusText: "503", text: async () => "", json: async () => null } as Response;
  });
  const client = new SemaphoreClient({ ...CONFIG, retry: { maxRetries: 2, retryOn: [503] } });
  await assert.rejects(() => client.projects.list(), SemaphoreApiError);
  assert.equal(calls, 3, "1 intento inicial + 2 reintentos");
  fm.mock.restore();
  tm.mock.restore();
});

test("retries succeed when later attempt returns 200", async () => {
  const tm = mockInstantRetry();
  const fm = mockFetch([{ status: 503 }, { status: 503 }, { status: 200, body: [] }]);
  const client = new SemaphoreClient({ ...CONFIG, retry: { maxRetries: 2, retryOn: [503] } });
  const result = await client.projects.list();
  assert.ok(Array.isArray(result));
  fm.mock.restore();
  tm.mock.restore();
});

test("does not retry on non-configured status codes", async () => {
  let calls = 0;
  const fm = mock.method(globalThis, "fetch", async () => {
    calls++;
    return { ok: false, status: 400, statusText: "400", text: async () => "", json: async () => null } as Response;
  });
  await assert.rejects(
    () => new SemaphoreClient({ ...CONFIG, retry: { maxRetries: 3 } }).projects.list(),
    SemaphoreApiError,
  );
  assert.equal(calls, 1, "no debe reintentar en 400");
  fm.mock.restore();
});

test("respects maxRetries: 0 (sin reintentos)", async () => {
  let calls = 0;
  const fm = mock.method(globalThis, "fetch", async () => {
    calls++;
    return { ok: false, status: 503, statusText: "503", text: async () => "", json: async () => null } as Response;
  });
  await assert.rejects(
    () => new SemaphoreClient({ ...CONFIG, retry: { maxRetries: 0, retryOn: [503] } }).projects.list(),
    SemaphoreApiError,
  );
  assert.equal(calls, 1);
  fm.mock.restore();
});

// — error propagation —

test("throws SemaphoreApiError con status correcto en error", async () => {
  const fm = mockFetch([{ status: 403 }]);
  await assert.rejects(
    () => new SemaphoreClient(CONFIG).projects.list(),
    (e: unknown) => e instanceof SemaphoreApiError && e.status === 403 && e.isPermission,
  );
  fm.mock.restore();
});

test("401 lanza error con isAuth = true", async () => {
  const fm = mockFetch([{ status: 401 }]);
  await assert.rejects(
    () => new SemaphoreClient(CONFIG).projects.list(),
    (e: unknown) => e instanceof SemaphoreApiError && e.isAuth,
  );
  fm.mock.restore();
});

test("get() devuelve null en 404", async () => {
  const fm = mockFetch([{ status: 404 }]);
  assert.equal(await new SemaphoreClient(CONFIG).projects.get(1), null);
  fm.mock.restore();
});

test("get() relanza error en 500", async () => {
  const fm = mockFetch([{ status: 500 }]);
  await assert.rejects(
    () => new SemaphoreClient(CONFIG).projects.get(1),
    (e: unknown) => e instanceof SemaphoreApiError && e.status === 500,
  );
  fm.mock.restore();
});

test("error body del servidor queda en SemaphoreApiError.body", async () => {
  const fm = mockFetch([{ status: 400, body: { error: "invalid name" } }]);
  await assert.rejects(
    () => new SemaphoreClient(CONFIG).projects.list(),
    (e: unknown) => {
      assert.ok(e instanceof SemaphoreApiError);
      assert.ok(String(e.body).includes("invalid name"));
      return true;
    },
  );
  fm.mock.restore();
});

// — 204 No Content —

test("update() devuelve undefined en 204", async () => {
  const fm = mockFetch([{ status: 204 }]);
  const result = await new SemaphoreClient(CONFIG).keys.update(1, 1, { name: "x" });
  assert.equal(result, undefined);
  fm.mock.restore();
});

test("delete() devuelve undefined en 204", async () => {
  const fm = mockFetch([{ status: 204 }]);
  const result = await new SemaphoreClient(CONFIG).keys.delete(1, 1);
  assert.equal(result, undefined);
  fm.mock.restore();
});

// — hooks —

test("onRequest recibe method y url de cada petición", async () => {
  const fm = mockFetch([{ status: 200, body: [] }]);
  const log: Array<{ method: string; url: string }> = [];
  const client = new SemaphoreClient({ ...CONFIG, onRequest: (r) => log.push(r) });
  await client.projects.list();
  assert.equal(log.length, 1);
  assert.equal(log[0].method, "GET");
  assert.match(log[0].url, /\/api\/projects$/);
  fm.mock.restore();
});

test("onResponse recibe status y durationMs >= 0", async () => {
  const fm = mockFetch([{ status: 200, body: [] }]);
  const log: Array<{ status: number; durationMs: number }> = [];
  const client = new SemaphoreClient({ ...CONFIG, onResponse: (r) => log.push(r) });
  await client.projects.list();
  assert.equal(log.length, 1);
  assert.equal(log[0].status, 200);
  assert.ok(log[0].durationMs >= 0);
  fm.mock.restore();
});

test("onResponse se llama incluso cuando el servidor devuelve error", async () => {
  const fm = mockFetch([{ status: 500 }]);
  const statuses: number[] = [];
  const client = new SemaphoreClient({ ...CONFIG, onResponse: (r) => statuses.push(r.status) });
  await assert.rejects(() => client.projects.list());
  assert.deepEqual(statuses, [500]);
  fm.mock.restore();
});

// — URL construction —

test("request usa baseUrl + /api + endpoint", async () => {
  let capturedUrl = "";
  const fm = mock.method(globalThis, "fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return { ok: true, status: 200, json: async () => [] } as Response;
  });
  const client = new SemaphoreClient({ baseUrl: "http://host:3000/", apiToken: "tok" });
  await client.projects.list();
  assert.equal(capturedUrl, "http://host:3000/api/projects");
  fm.mock.restore();
});

test("baseUrl trailing slash se normaliza", async () => {
  let capturedUrl = "";
  const fm = mock.method(globalThis, "fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return { ok: true, status: 200, json: async () => [] } as Response;
  });
  const client = new SemaphoreClient({ baseUrl: "http://host:3000///", apiToken: "tok" });
  await client.projects.list();
  assert.ok(!capturedUrl.includes("//api"), `URL no debería tener doble slash: ${capturedUrl}`);
  fm.mock.restore();
});

// — query params —

test("params de lista se añaden como query string", async () => {
  let capturedUrl = "";
  const fm = mock.method(globalThis, "fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return { ok: true, status: 200, json: async () => [] } as Response;
  });
  await new SemaphoreClient(CONFIG).tasks.list(1, { limit: 5, start: 10 });
  assert.match(capturedUrl, /limit=5/);
  assert.match(capturedUrl, /start=10/);
  fm.mock.restore();
});

// — tasks.run arguments —

function captureBody() {
  let captured: unknown;
  const fm = mock.method(globalThis, "fetch", async (_url: unknown, opts?: RequestInit) => {
    captured = opts?.body ? JSON.parse(opts.body as string) : undefined;
    return { ok: true, status: 201, json: async () => ({ id: 1, status: "waiting" }) } as Response;
  });
  return { fm, body: () => captured };
}

test("run() sin arguments no incluye el campo en el body", async () => {
  const { fm, body } = captureBody();
  await new SemaphoreClient(CONFIG).tasks.run(1, { templateId: 42 });
  assert.ok(!Object.prototype.hasOwnProperty.call(body(), "arguments"));
  fm.mock.restore();
});

test("run() con arguments flag simple (-v)", async () => {
  const { fm, body } = captureBody();
  await new SemaphoreClient(CONFIG).tasks.run(1, { templateId: 42, arguments: "-v" });
  assert.equal((body() as Record<string, unknown>).arguments, "-v");
  fm.mock.restore();
});

test("run() con arguments extra-vars Ansible", async () => {
  const { fm, body } = captureBody();
  const args = "--extra-vars 'env=production version=1.2.3'";
  await new SemaphoreClient(CONFIG).tasks.run(1, { templateId: 42, arguments: args });
  assert.equal((body() as Record<string, unknown>).arguments, args);
  fm.mock.restore();
});

test("run() con arguments múltiples flags", async () => {
  const { fm, body } = captureBody();
  const args = "--tags deploy --skip-tags test --check";
  await new SemaphoreClient(CONFIG).tasks.run(1, { templateId: 42, arguments: args });
  assert.equal((body() as Record<string, unknown>).arguments, args);
  fm.mock.restore();
});

test("run() con arguments string vacío lo incluye en el body", async () => {
  const { fm, body } = captureBody();
  await new SemaphoreClient(CONFIG).tasks.run(1, { templateId: 42, arguments: "" });
  assert.equal((body() as Record<string, unknown>).arguments, "");
  fm.mock.restore();
});

test("run() arguments coexiste con limit y playbook override", async () => {
  const { fm, body } = captureBody();
  await new SemaphoreClient(CONFIG).tasks.run(1, {
    templateId: 42,
    playbook: "site.yml",
    limit: "web_servers",
    arguments: "--tags rollback",
  });
  const b = body() as Record<string, unknown>;
  assert.equal(b.playbook, "site.yml");
  assert.equal(b.limit, "web_servers");
  assert.equal(b.arguments, "--tags rollback");
  fm.mock.restore();
});

// — AbortSignal —

test("AbortSignal ya abortado lanza error en tasks.list", async () => {
  const fm = mock.method(globalThis, "fetch", async (_url: unknown, opts?: RequestInit) => {
    if (opts?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return { ok: true, status: 200, json: async () => [] } as Response;
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => new SemaphoreClient(CONFIG).tasks.list(1, { signal: controller.signal }),
  );
  fm.mock.restore();
});
