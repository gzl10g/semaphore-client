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

// ── global roles ──

const ROLE = { slug: "deployer", name: "Deployer", permissions: 5, project_id: null };

/**
 * The regression that live verification caught: `permissions` is listed in
 * `DERIVED_FIELDS` because on a project object it is a counter the server
 * computes. On a global role it is the entire payload, so the merge stripped it
 * and the PUT stored 0 — renaming a role took away everything it could do.
 */
test("roles.update() keeps the permissions the merge would strip", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 200, body: ROLE }, { status: 204 }], captured);
  try {
    await new SemaphoreClient(CONFIG).roles.update("deployer", { name: "Renamed" });
  } finally {
    f.mock.restore();
  }

  // El cuerpo ENTERO, no tres campos sueltos: así también falla si alguien
  // abandona el merge, si el mapeo de input se deja algo, o si un campo nuevo
  // del rol cae en el drop-list compartido de merge.ts.
  const put = captured[1] as Captured;
  assert.deepEqual(captured.map((c) => c.method), ["GET", "PUT"]);
  assert.deepEqual(put.body, { ...ROLE, name: "Renamed" });
});

test("roles.update() applies the permissions it is given", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 200, body: ROLE }, { status: 204 }], captured);
  try {
    await new SemaphoreClient(CONFIG).roles.update("deployer", { permissions: 15 });
  } finally {
    f.mock.restore();
  }
  assert.equal((captured[1] as Captured).body?.["permissions"], 15);
});

test("roles.get() returns null on 404 and re-throws anything else", async () => {
  const f = mockFetch([{ status: 404, body: { error: "not found" } }]);
  try {
    assert.equal(await new SemaphoreClient(CONFIG).roles.get("ghost"), null);
  } finally {
    f.mock.restore();
  }

  const g = mockFetch([{ status: 500, body: { error: "boom" } }]);
  try {
    await assert.rejects(() => new SemaphoreClient(CONFIG).roles.get("ghost"), SemaphoreApiError);
  } finally {
    g.mock.restore();
  }
});

test("roles.create() sends a bitmask even when none was given", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 201, body: ROLE }], captured);
  try {
    await new SemaphoreClient(CONFIG).roles.create({ slug: "guest", name: "Guest" });
  } finally {
    f.mock.restore();
  }
  assert.deepEqual((captured[0] as Captured).body, { slug: "guest", name: "Guest", permissions: 0 });
});

test("a role slug with characters of its own is escaped into the URL", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 204 }], captured);
  try {
    await new SemaphoreClient(CONFIG).roles.delete("a b/c");
  } finally {
    f.mock.restore();
  }
  assert.ok((captured[0] as Captured).url.endsWith("/api/roles/a%20b%2Fc"));
});

// ── apps ──

const APP = {
  active: true,
  priority: 10,
  title: "Custom",
  icon: "cog",
  color: "blue",
  dark_color: "",
  path: "/bin/echo",
  args: null,
};

/**
 * The other regression live verification caught: `PUT /apps/{id}` is also how
 * an app is created, so reading first and failing on 404 made it impossible to
 * create one.
 */
test("apps.update() creates an app that does not exist yet", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 404, body: { error: "app not found" } }, { status: 204 }], captured);
  try {
    await new SemaphoreClient(CONFIG).apps.update("brandnew", { title: "New", active: true });
  } finally {
    f.mock.restore();
  }

  const put = captured[1] as Captured;
  assert.equal(put.method, "PUT");
  assert.deepEqual(put.body, { title: "New", active: true });
});

// Verified on 2.19.12: a partial PUT answers 204 and leaves `active: false`
// and `priority: 0`, so renaming an app turns it off.
test("apps.update() does not switch the app off while renaming it", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 200, body: APP }, { status: 204 }], captured);
  try {
    await new SemaphoreClient(CONFIG).apps.update("custom", { title: "Renamed" });
  } finally {
    f.mock.restore();
  }

  // Igual que en roles: el cuerpo entero. Con solo active/priority/title, un
  // update que reenviara esos tres y perdiera `path` —el ejecutable que corre
  // la app—, `icon`, `color` o `args` pasaba en verde.
  assert.deepEqual(captured.map((c) => c.method), ["GET", "PUT"]);
  assert.deepEqual((captured[1] as Captured).body, { ...APP, title: "Renamed" });
});

/**
 * `setApp` writes one option per field and returns on the first rejected key,
 * so an id the store refuses is a 500 with some fields already written — and
 * which ones depends on Go map ordering. The request must not leave.
 */
test("an app id the option store would reject never reaches the wire", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 200, body: APP }], captured);
  try {
    for (const call of [
      (c: SemaphoreClient) => c.apps.update("smc2-app", { title: "x" }),
      (c: SemaphoreClient) => c.apps.setActive("smc2-app", true),
      (c: SemaphoreClient) => c.apps.delete("smc2-app"),
    ]) {
      await assert.rejects(() => call(new SemaphoreClient(CONFIG)), (err: unknown) => {
        assert.ok(err instanceof SemaphoreApiError);
        assert.match(String(err.message), /option key/);
        return true;
      });
    }
  } finally {
    f.mock.restore();
  }
  assert.equal(captured.length, 0);
});

test("a dotted or underscored app id is accepted", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 204 }], captured);
  try {
    await new SemaphoreClient(CONFIG).apps.setActive("my_app.v2", false);
  } finally {
    f.mock.restore();
  }
  assert.ok((captured[0] as Captured).url.endsWith("/api/apps/my_app.v2/active"));
  assert.deepEqual((captured[0] as Captured).body, { active: false });
});

test("apps.get() returns null on 404", async () => {
  const f = mockFetch([{ status: 404, body: { error: "app not found" } }]);
  try {
    assert.equal(await new SemaphoreClient(CONFIG).apps.get("ghost"), null);
  } finally {
    f.mock.restore();
  }
});

/**
 * Peor que perder un error: `update()` lee a través de `get()`, así que un 500
 * o un 403 convertido en `null` no aborta nada — mergea contra `{}` y manda un
 * body PARCIAL, que en un PUT de reemplazo total vacía la app. Es la misma
 * disciplina que `merge.test.ts` fija para las que pasan por `readForUpdate`.
 */
test("apps.get() re-throws anything that is not a 404", async () => {
  for (const status of [500, 403]) {
    const f = mockFetch([{ status, body: { error: "nope" } }]);
    try {
      await assert.rejects(() => new SemaphoreClient(CONFIG).apps.get("custom"), SemaphoreApiError);
    } finally {
      f.mock.restore();
    }
  }
});

test("un fallo al leer la app aborta el update en vez de vaciarla", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 500, body: { error: "boom" } }], captured);
  try {
    await assert.rejects(
      () => new SemaphoreClient(CONFIG).apps.update("custom", { title: "Renamed" }),
      SemaphoreApiError,
    );
  } finally {
    f.mock.restore();
  }
  // El GET salió; el PUT no.
  assert.deepEqual(captured.map((c) => c.method), ["GET"]);
});

// ── instance task pool ──

const POOL = [
  { task_id: 1, project_id: 2, status: "waiting", location: "queue", username: "a" },
  { task_id: 2, project_id: 2, status: "running", location: "running", username: "b" },
];

test("instanceTasks.list() reads the pool, and the filters split it", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 200, body: POOL }], captured);
  try {
    const c = new SemaphoreClient(CONFIG);
    assert.equal((await c.instanceTasks.list()).length, 2);
    assert.deepEqual((await c.instanceTasks.listQueued()).map((t) => t.task_id), [1]);
    assert.deepEqual((await c.instanceTasks.listRunning()).map((t) => t.task_id), [2]);
  } finally {
    f.mock.restore();
  }
  assert.ok((captured[0] as Captured).url.endsWith("/api/tasks"));
});

test("instanceTasks.stop() hits the instance endpoint, not the project one", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 204 }], captured);
  try {
    await new SemaphoreClient(CONFIG).instanceTasks.stop(7);
  } finally {
    f.mock.restore();
  }
  assert.equal((captured[0] as Captured).method, "DELETE");
  assert.ok((captured[0] as Captured).url.endsWith("/api/tasks/7"));
});

// `.` y `..` pasan el regex del servidor, y `new URL()` los normaliza: un
// `delete("..")` saldría como `DELETE /api/`, a un endpoint que nadie nombró.
test("un id o un slug que se escaparía de su endpoint no sale a la red", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 200, body: APP }], captured);
  try {
    for (const call of [
      (c: SemaphoreClient) => c.apps.delete(".."),
      (c: SemaphoreClient) => c.apps.setActive(".", true),
      (c: SemaphoreClient) => c.roles.delete(".."),
      (c: SemaphoreClient) => c.roles.get("."),
      (c: SemaphoreClient) => c.roles.update("..", { name: "x" }),
      (c: SemaphoreClient) => c.roles.delete(""),
    ]) {
      await assert.rejects(() => call(new SemaphoreClient(CONFIG)), SemaphoreApiError);
    }
  } finally {
    f.mock.restore();
  }
  assert.equal(captured.length, 0);
});

test("un punto dentro del id sigue siendo válido", async () => {
  const captured: Captured[] = [];
  const f = mockFetch([{ status: 204 }], captured);
  try {
    await new SemaphoreClient(CONFIG).apps.setActive("a.b", true);
  } finally {
    f.mock.restore();
  }
  assert.ok((captured[0] as Captured).url.endsWith("/api/apps/a.b/active"));
});
