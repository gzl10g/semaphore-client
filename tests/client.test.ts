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
  // update() lee primero (el PUT del servidor es full-replace), así que el mock
  // devuelve la key y luego el 204.
  const fm = mockFetch([
    { status: 200, body: { id: 1, project_id: 1, name: "deploy", type: "ssh" } },
    { status: 204 },
  ]);
  const result = await new SemaphoreClient(CONFIG).keys.update(1, 1, { name: "x" });
  assert.equal(result, undefined);
  assert.equal(fm.mock.calls.length, 2, "una lectura y una escritura");
  assert.equal((fm.mock.calls[0]?.arguments[1] as { method?: string } | undefined)?.method ?? "GET", "GET");
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
    return { ok: true, status: 200, text: async () => "[]", json: async () => [] } as Response;
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
    return { ok: true, status: 200, text: async () => "[]", json: async () => [] } as Response;
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
    return { ok: true, status: 200, text: async () => "[]", json: async () => [] } as Response;
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
    const body = { id: 1, status: "waiting" };
    return { ok: true, status: 201, text: async () => JSON.stringify(body), json: async () => body } as Response;
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
    return { ok: true, status: 200, text: async () => "[]", json: async () => [] } as Response;
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => new SemaphoreClient(CONFIG).tasks.list(1, { signal: controller.signal }),
  );
  fm.mock.restore();
});

// — dry_run/debug van en params: arriba, desde 2.14, el servidor los tira —

test("run() manda debug/dry_run/diff en params, y arriba para servidores < 2.14", async () => {
  const { fm, body } = captureBody();
  await new SemaphoreClient(CONFIG).tasks.run(1, { templateId: 42, dryRun: true, diff: true });
  fm.mock.restore();
  const b = body() as Record<string, unknown>;
  assert.deepEqual(b["params"], { debug: false, dry_run: true, diff: true });
  assert.equal(b["dry_run"], true);
});

test("run() sin dryRun manda params.dry_run false, no lo omite", async () => {
  const { fm, body } = captureBody();
  await new SemaphoreClient(CONFIG).tasks.run(1, { templateId: 42 });
  fm.mock.restore();
  assert.deepEqual((body() as Record<string, unknown>)["params"], { debug: false, dry_run: false });
});

function respondWith(payload: unknown) {
  return mock.method(globalThis, "fetch", async () => {
    return { ok: true, status: 200, text: async () => JSON.stringify(payload), json: async () => payload } as Response;
  });
}

test("tasks.get() sube params.dry_run al nivel superior, false si falta", async () => {
  let fm = respondWith({ id: 1, status: "success", params: { dry_run: true } });
  assert.equal((await new SemaphoreClient(CONFIG).tasks.get(1, 1))?.dry_run, true);
  fm.mock.restore();
  fm = respondWith({ id: 2, status: "success" });
  assert.equal((await new SemaphoreClient(CONFIG).tasks.get(1, 2))?.dry_run, false);
  fm.mock.restore();
});

test("templates.get() expone limit/tags/skip_tags de task_params en plantillas ansible", async () => {
  let fm = respondWith({ id: 1, app: "ansible", task_params: { limit: ["!nas01"], tags: ["t"] } });
  const t = await new SemaphoreClient(CONFIG).templates.get(1, 1);
  fm.mock.restore();
  assert.deepEqual([t?.limit, t?.tags, t?.skip_tags], [["!nas01"], ["t"], []]);

  fm = respondWith({ id: 2, app: "terraform", task_params: { auto_approve: true } });
  const tf = await new SemaphoreClient(CONFIG).templates.get(1, 2);
  fm.mock.restore();
  assert.equal(tf?.limit, undefined, "terraform has no limit to show");
});

test("tasks.list({status}) filtra en el cliente: el servidor ignora el parámetro", async () => {
  const fm = respondWith([{ id: 1, status: "success" }, { id: 2, status: "error" }, { id: 3, status: "error" }]);
  const tasks = await new SemaphoreClient(CONFIG).tasks.list(1, { status: "error" });
  fm.mock.restore();
  assert.deepEqual(tasks.map((t) => t.id), [2, 3]);
});

// — tasks.run: overrides nuevos (P6/P7/P8) —

test("run() puts tags, skip_tags, debug_level and the terraform flags in params, and the rest at the top level", async () => {
  const { fm, body } = captureBody();
  await new SemaphoreClient(CONFIG).tasks.run(1, {
    templateId: 42,
    tags: ["a"],
    skipTags: ["b"],
    debugLevel: 3,
    plan: true,
    destroy: false,
    autoApprove: true,
    upgrade: true,
    reconfigure: true,
    inventoryId: 7,
    gitBranch: "dev",
    message: "why",
    buildTaskId: 11,
  });
  const b = body() as Record<string, unknown>;
  assert.deepEqual(b["params"], {
    debug: false,
    dry_run: false,
    debug_level: 3,
    tags: ["a"],
    skip_tags: ["b"],
    plan: true,
    destroy: false,
    auto_approve: true,
    upgrade: true,
    reconfigure: true,
  });
  assert.deepEqual([b["inventory_id"], b["git_branch"], b["message"], b["build_task_id"]], [7, "dev", "why", 11]);
  fm.mock.restore();
});

test("run() leaves out every new override that was not asked for", async () => {
  const { fm, body } = captureBody();
  await new SemaphoreClient(CONFIG).tasks.run(1, { templateId: 42 });
  const b = body() as Record<string, unknown>;
  assert.deepEqual(b["params"], { debug: false, dry_run: false });
  for (const k of ["inventory_id", "git_branch", "message", "build_task_id"]) assert.ok(!(k in b), k);
  fm.mock.restore();
});

test("tasks.last() sends limit and before", async () => {
  let url = "";
  const fm = mock.method(globalThis, "fetch", async (u: unknown) => {
    url = String(u);
    return { ok: true, status: 200, text: async () => "[]", json: async () => [] } as unknown as Response;
  });
  await new SemaphoreClient(CONFIG).tasks.last(1, { limit: 3, before: 10 });
  fm.mock.restore();
  assert.match(url, /\/tasks\/last\?/);
  assert.match(url, /limit=3/);
  assert.match(url, /before=10/);
});
