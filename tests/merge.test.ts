import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { SemaphoreClient } from "../src/index.js";
import { SemaphoreApiError } from "../src/error.js";
import { mergeForUpdate } from "../src/resources/merge.js";

const CONFIG = { baseUrl: "http://semaphore.test", apiToken: "test-token" };

type Call = { method: string; url: string; body: Record<string, unknown> | undefined };

/** GET devuelve `existing`; cualquier otro método devuelve 204. */
function mockGetThenWrite(existing: unknown, calls: Call[]) {
  return mock.method(globalThis, "fetch", async (url: unknown, init: unknown) => {
    const opts = (init ?? {}) as { method?: string; body?: string };
    const method = opts.method ?? "GET";
    calls.push({
      method,
      url: String(url),
      body: opts.body ? (JSON.parse(opts.body) as Record<string, unknown>) : undefined,
    });
    if (method === "GET") {
      const text = JSON.stringify(existing);
      return { ok: true, status: 200, statusText: "200", text: async () => text, json: async () => JSON.parse(text) } as Response;
    }
    return { ok: true, status: 204, statusText: "204", text: async () => "", json: async () => null } as Response;
  });
}

function putBody(calls: Call[]): Record<string, unknown> {
  const put = calls.find((c) => c.method === "PUT");
  assert.ok(put, "debe enviarse un PUT");
  return put.body ?? {};
}

// — el helper —

test("mergeForUpdate conserva campos que el client no tipa", () => {
  const body = mergeForUpdate({ id: 1, name: "a", campo_del_futuro: [1, 2] }, { name: "b" });
  assert.deepEqual(body, { id: 1, name: "b", campo_del_futuro: [1, 2] });
});

test("mergeForUpdate descarta los campos derivados que el PUT no debe recibir", () => {
  const body = mergeForUpdate(
    { id: 1, name: "a", last_task: { id: 9 }, tasks: 16, permissions: 5, tpl_name: "x", user_name: "y", enabled: true },
    {},
  );
  assert.deepEqual(Object.keys(body).sort(), ["id", "name"]);
});

test("mergeForUpdate ignora los cambios undefined en vez de borrar el campo", () => {
  const body = mergeForUpdate({ id: 1, name: "a", type: "ssh" }, { name: undefined, type: "login" });
  assert.equal(body["name"], "a");
  assert.equal(body["type"], "login");
});

test("mergeForUpdate conserva los null del servidor: no son 'campo ausente'", () => {
  const body = mergeForUpdate({ id: 1, name: "hosts", ssh_key_id: null, become_key_id: null }, { name: "hosts-prod" });
  assert.ok("ssh_key_id" in body && body["ssh_key_id"] === null);
  assert.ok("become_key_id" in body && body["become_key_id"] === null);
});

// — templates —

const TEMPLATE = {
  id: 21,
  project_id: 1,
  name: "Deploy",
  playbook: "deploy.yml",
  app: "ansible",
  inventory_id: 1,
  repository_id: 1,
  environment_id: 1,
  environment_ids: [1, 4],
  survey_vars: [{ name: "target", required: true }],
  task_params: { allow_override_limit: true },
  autorun: true,
  git_branch: "main",
  // Derivados: el servidor los manda en el GET pero no deben volver en el PUT.
  last_task: { id: 4155 },
  tasks: 16,
  permissions: 5,
};

test("templates.update() cambia el nombre sin perder survey_vars, task_params ni app", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite(TEMPLATE, calls);
  await new SemaphoreClient(CONFIG).templates.update(1, 21, { name: "Deploy v2" });
  fm.mock.restore();

  assert.deepEqual(calls.map((c) => c.method), ["GET", "PUT"], "primero se lee, luego se escribe");
  const body = putBody(calls);
  assert.equal(body["name"], "Deploy v2");
  assert.deepEqual(body["survey_vars"], TEMPLATE.survey_vars);
  assert.deepEqual(body["task_params"], TEMPLATE.task_params);
  assert.equal(body["app"], "ansible", "sin app el servidor responde 400 Invalid app id");
  assert.equal(body["autorun"], true);
  assert.equal(body["git_branch"], "main");
});

test("templates.update() no reenvía los campos derivados del GET", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite(TEMPLATE, calls);
  await new SemaphoreClient(CONFIG).templates.update(1, 21, { name: "x" });
  fm.mock.restore();

  const body = putBody(calls);
  for (const k of ["last_task", "tasks", "permissions"]) {
    assert.ok(!(k in body), `${k} no debe viajar en el PUT`);
  }
});

test("templates.update() con environmentId reescribe environment_ids, que es la fuente de verdad", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite(TEMPLATE, calls);
  await new SemaphoreClient(CONFIG).templates.update(1, 21, { environmentId: 9 });
  fm.mock.restore();

  const body = putBody(calls);
  assert.equal(body["environment_id"], 9);
  assert.deepEqual(body["environment_ids"], [9], "el servidor ignora environment_id si llega la lista");
});

test("templates.update() con environmentIds gana sobre environmentId, y admite la lista vacía", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite(TEMPLATE, calls);
  const client = new SemaphoreClient(CONFIG);
  await client.templates.update(1, 21, { environmentId: 9, environmentIds: [2, 3] });
  await client.templates.update(1, 21, { environmentIds: [] });
  fm.mock.restore();

  const puts = calls.filter((c) => c.method === "PUT");
  assert.deepEqual(puts[0]?.body?.["environment_ids"], [2, 3]);
  assert.deepEqual(puts[1]?.body?.["environment_ids"], [], "vaciar la lista desvincula los grupos");
});

test("templates.update() con 404 en el GET no llega a mandar el PUT", async () => {
  const calls: Call[] = [];
  const fm = mock.method(globalThis, "fetch", async (url: unknown, init: unknown) => {
    const o = (init ?? {}) as { method?: string };
    calls.push({ method: o.method ?? "GET", url: String(url), body: undefined });
    return { ok: false, status: 404, statusText: "Not Found", text: async () => "", json: async () => null } as Response;
  });
  await assert.rejects(
    () => new SemaphoreClient(CONFIG).templates.update(1, 99, { name: "x" }),
    (e: unknown) => e instanceof SemaphoreApiError && e.isNotFound && /Template 99/.test(e.message),
  );
  fm.mock.restore();
  assert.deepEqual(calls.map((c) => c.method), ["GET"], "a un objeto que no existe no se le manda un PUT");
});

test("un 500 en el GET aborta el update en vez de degradar a un body parcial", async () => {
  const calls: Call[] = [];
  const fm = mock.method(globalThis, "fetch", async (url: unknown, init: unknown) => {
    const o = (init ?? {}) as { method?: string };
    calls.push({ method: o.method ?? "GET", url: String(url), body: undefined });
    return { ok: false, status: 500, statusText: "Internal Server Error", text: async () => "boom", json: async () => null } as Response;
  });
  await assert.rejects(() => new SemaphoreClient(CONFIG).templates.update(1, 21, { name: "x" }));
  fm.mock.restore();
  assert.deepEqual(calls.map((c) => c.method), ["GET"], "ni PUT ni reintentos en un 500");
});

test("un GET ilegible no se convierte en un 'not found' falso", async () => {
  const fm = mock.method(globalThis, "fetch", async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    // Un 2xx con cuerpo que NO es JSON (el HTML de un proxy, por ejemplo).
    text: async () => "<html>gateway</html>",
    json: async () => { throw new SyntaxError("Unexpected token <"); },
  }) as unknown as Response);
  await assert.rejects(
    () => new SemaphoreClient(CONFIG).templates.update(1, 21, { name: "x" }),
    (e: unknown) => e instanceof SemaphoreApiError && !/not found/i.test(e.message),
  );
  fm.mock.restore();
});

test("un 403 durante el update se reporta como el write que era, no como el GET interno", async () => {
  const fm = mock.method(globalThis, "fetch", async () =>
    ({ ok: false, status: 403, statusText: "Forbidden", text: async () => "", json: async () => null }) as Response);
  await assert.rejects(
    () => new SemaphoreClient(CONFIG).templates.update(1, 21, { name: "x" }),
    (e: unknown) => e instanceof SemaphoreApiError && e.isPermission && e.method === "PUT",
  );
  fm.mock.restore();
});

// — keys —

const KEY = {
  id: 3,
  project_id: 1,
  name: "deploy",
  type: "ssh",
  IgnorePlain: false,
  string: "",
  login_password: { login: "", password: "" },
  ssh: { login: "", passphrase: "", private_key: "" },
};

test("keys.update() sin secreto no manda contenedores de secreto vacíos", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite(KEY, calls);
  await new SemaphoreClient(CONFIG).keys.update(1, 3, { name: "deploy-2" });
  fm.mock.restore();

  const body = putBody(calls);
  assert.equal(body["name"], "deploy-2");
  assert.equal(body["type"], "ssh", "el tipo se conservaba a cero antes del merge");
  for (const k of ["ssh", "login_password", "string", "secret"]) {
    assert.ok(!(k in body), `${k} no debe viajar en un update sin secreto`);
  }
});

test("keys.update() con secreto lo manda en el contenedor del tipo, con override_secret", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite(KEY, calls);
  await new SemaphoreClient(CONFIG).keys.update(1, 3, { secret: { privateKey: "KEY" } });
  fm.mock.restore();

  const body = putBody(calls);
  // `AccessKey.Secret` es `json:"-"`: un body con `secret` lo descarta el servidor entero.
  assert.ok(!("secret" in body), "el material no viaja en un campo `secret`");
  assert.deepEqual(body["ssh"], { login: "", passphrase: "", private_key: "KEY" });
  assert.equal(body["override_secret"], true, "sin este flag el servidor no reescribe el secreto");
  assert.equal(body["type"], "ssh");
});

test("keys.update() rechaza cambiar el tipo sin dar el secreto nuevo", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite(KEY, calls);
  await assert.rejects(
    () => new SemaphoreClient(CONFIG).keys.update(1, 3, { type: "login_password" }),
    (e: unknown) => e instanceof Error && /requires the secret/.test(e.message),
  );
  fm.mock.restore();
  assert.ok(!calls.some((c) => c.method === "PUT"), "no se manda un PUT que el servidor ignoraría");
});

test("keys.create() manda el material en el contenedor del tipo, no en `secret`", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite(KEY, calls);
  await new SemaphoreClient(CONFIG).keys.create({
    name: "deploy",
    type: "login_password",
    projectId: 1,
    secret: { login: "svc", password: "pw" },
  });
  fm.mock.restore();

  const post = calls.find((c) => c.method === "POST");
  assert.ok(post, "debe enviarse un POST");
  assert.ok(!("secret" in (post.body ?? {})), "el servidor descarta `secret`: la key nacía vacía");
  assert.deepEqual(post.body?.["login_password"], { login: "svc", password: "pw" });
});

// — resto de recursos —

test("environment.update() cambia el nombre sin vaciar las variables", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite(
    { id: 9, project_id: 1, name: "caddy", env: '{"A":"1"}', json: "{}", secret_storage_id: 2 },
    calls,
  );
  await new SemaphoreClient(CONFIG).environment.update(1, 9, { name: "caddy-int" });
  fm.mock.restore();

  const body = putBody(calls);
  assert.equal(body["name"], "caddy-int");
  assert.equal(body["env"], '{"A":"1"}');
  assert.equal(body["secret_storage_id"], 2);
});

test("inventory.update() cambia el nombre sin resetear tipo ni claves", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite(
    { id: 1, project_id: 1, name: "hosts", inventory: "hosts.yml", type: "file", ssh_key_id: 2, repository_id: 1 },
    calls,
  );
  await new SemaphoreClient(CONFIG).inventory.update(1, 1, { name: "hosts-prod" });
  fm.mock.restore();

  const body = putBody(calls);
  assert.equal(body["type"], "file");
  assert.equal(body["ssh_key_id"], 2);
  assert.equal(body["repository_id"], 1);
});

test("repositories.update() cambia la rama sin borrar url ni clave", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite(
    { id: 1, project_id: 1, name: "homelab", git_url: "git@host:infra/homelab.git", git_branch: "main", ssh_key_id: 2 },
    calls,
  );
  await new SemaphoreClient(CONFIG).repositories.update(1, 1, { gitBranch: "next" });
  fm.mock.restore();

  const body = putBody(calls);
  assert.equal(body["git_branch"], "next");
  assert.equal(body["git_url"], "git@host:infra/homelab.git");
  assert.equal(body["ssh_key_id"], 2);
});

test("projects.update() cambia el nombre sin resetear alert ni max_parallel_tasks", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite(
    { id: 2, name: "Sandbox", created: "2026-01-01T00:00:00Z", alert: true, max_parallel_tasks: 4, type: "" },
    calls,
  );
  await new SemaphoreClient(CONFIG).projects.update(2, { name: "Sandbox 2" });
  fm.mock.restore();

  const body = putBody(calls);
  assert.equal(body["name"], "Sandbox 2");
  assert.equal(body["alert"], true);
  assert.equal(body["max_parallel_tasks"], 4);
});

test("schedules.update() conserva name y delete_after_run, que antes se perdían", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite(
    {
      id: 1,
      project_id: 1,
      template_id: 9,
      cron_format: "0 * * * *",
      name: "nightly",
      active: true,
      type: "",
      delete_after_run: true,
      repository_id: null,
    },
    calls,
  );
  await new SemaphoreClient(CONFIG).schedules.update(1, 1, { cronFormat: "0 3 * * *" });
  fm.mock.restore();

  const body = putBody(calls);
  assert.equal(body["cron_format"], "0 3 * * *");
  assert.equal(body["name"], "nightly");
  assert.equal(body["delete_after_run"], true);
  assert.equal(body["active"], true);
  assert.ok(!("enabled" in body), "enabled es un alias del client, no un campo de la API");
  assert.ok(!("repository_id" in body), "un repository_id null se omite: no es lo mismo que mandarlo");
});

test("schedules.update() con repositoryId explícito sí lo manda", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite(
    { id: 1, project_id: 1, template_id: 9, cron_format: "0 * * * *", active: true, repository_id: null },
    calls,
  );
  await new SemaphoreClient(CONFIG).schedules.update(1, 1, { repositoryId: 7 });
  fm.mock.restore();
  assert.equal(putBody(calls)["repository_id"], 7);
});

test("users.update() cambia el nombre sin borrar email ni el flag admin", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite(
    { id: 4, name: "Zoe", username: "zoe", email: "zoe@example.com", admin: true, created: "2026-01-01T00:00:00Z" },
    calls,
  );
  await new SemaphoreClient(CONFIG).users.update(4, { name: "Zoe R." });
  fm.mock.restore();

  const body = putBody(calls);
  assert.equal(body["name"], "Zoe R.");
  assert.equal(body["email"], "zoe@example.com");
  assert.equal(body["admin"], true);
  assert.equal(body["username"], "zoe");
});

// — secretos de variable group y multi-grupo en templates —

test("environment.create() serializa los secretos con su operación", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite({ id: 30, project_id: 2, name: "zz" }, calls);
  await new SemaphoreClient(CONFIG).environment.create({
    name: "zz",
    projectId: 2,
    secrets: [
      { type: "var", name: "TOKEN", secret: "aaa" },
      { type: "env", name: "PASS", secret: "bbb" },
    ],
  });
  fm.mock.restore();

  const post = calls.find((c) => c.method === "POST");
  assert.deepEqual(post?.body?.["secrets"], [
    { type: "var", name: "TOKEN", secret: "aaa", operation: "create" },
    { type: "env", name: "PASS", secret: "bbb", operation: "create" },
  ]);
});

test("environment.update() marca update cuando el secreto trae id, y respeta un delete explícito", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite(
    { id: 30, project_id: 2, name: "zz", env: "{}", json: "{}", secrets: [{ id: 7, type: "var", name: "TOKEN", secret: "" }] },
    calls,
  );
  await new SemaphoreClient(CONFIG).environment.update(2, 30, {
    secrets: [
      { id: 7, type: "var", name: "TOKEN", secret: "nuevo" },
      { id: 8, type: "env", name: "VIEJO", operation: "delete" },
    ],
  });
  fm.mock.restore();

  assert.deepEqual(putBody(calls)["secrets"], [
    { type: "var", name: "TOKEN", secret: "nuevo", operation: "update", id: 7 },
    { type: "env", name: "VIEJO", secret: "", operation: "delete", id: 8 },
  ]);
});

test("templates.create() manda environment_ids aunque solo se dé environmentId", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite(TEMPLATE, calls);
  const client = new SemaphoreClient(CONFIG);
  await client.templates.create({
    name: "t", projectId: 1, inventoryId: 1, repositoryId: 1, environmentId: 5, playbook: "p.yml",
  });
  await client.templates.create({
    name: "t2", projectId: 1, inventoryId: 1, repositoryId: 1, environmentId: 5, environmentIds: [5, 6], playbook: "p.yml",
  });
  fm.mock.restore();

  const posts = calls.filter((c) => c.method === "POST");
  assert.deepEqual(posts[0]?.body?.["environment_ids"], [5]);
  assert.deepEqual(posts[1]?.body?.["environment_ids"], [5, 6]);
});

test("schedules.create() manda el nombre cuando se da", async () => {
  const calls: Call[] = [];
  const fm = mock.method(globalThis, "fetch", async (url: unknown, init: unknown) => {
    const o = (init ?? {}) as { method?: string; body?: string };
    calls.push({
      method: o.method ?? "GET",
      url: String(url),
      body: o.body ? (JSON.parse(o.body) as Record<string, unknown>) : undefined,
    });
    const created = { id: 1, project_id: 1, template_id: 9, cron_format: "0 * * * *", name: "nightly", active: true };
    const text = JSON.stringify(created);
    return { ok: true, status: 201, statusText: "201", text: async () => text, json: async () => JSON.parse(text) } as Response;
  });
  await new SemaphoreClient(CONFIG).schedules.create({
    projectId: 1, templateId: 9, cronFormat: "0 * * * *", name: "nightly",
  });
  fm.mock.restore();
  assert.equal(calls.find((c) => c.method === "POST")?.body?.["name"], "nightly");
});

// — schedules de una sola ejecución, y secretos que sobreviven a un rename —

test("schedules.create() de tipo run_at manda run_at y no un cron inventado", async () => {
  const calls: Call[] = [];
  const fm = mock.method(globalThis, "fetch", async (url: unknown, init: unknown) => {
    const o = (init ?? {}) as { method?: string; body?: string };
    calls.push({
      method: o.method ?? "GET",
      url: String(url),
      body: o.body ? (JSON.parse(o.body) as Record<string, unknown>) : undefined,
    });
    const text = JSON.stringify({ id: 2, project_id: 1, template_id: 9, cron_format: "", type: "run_at", active: true });
    return { ok: true, status: 201, statusText: "201", text: async () => text, json: async () => JSON.parse(text) } as Response;
  });
  await new SemaphoreClient(CONFIG).schedules.create({
    projectId: 1, templateId: 9, type: "run_at", runAt: "2030-01-01T10:00:00Z", deleteAfterRun: true,
  });
  fm.mock.restore();

  const body = calls.find((c) => c.method === "POST")?.body ?? {};
  assert.equal(body["type"], "run_at");
  assert.equal(body["run_at"], "2030-01-01T10:00:00Z");
  assert.equal(body["delete_after_run"], true);
  assert.equal(body["cron_format"], "", "el servidor limpia el cron en un run_at: no se inventa uno");
});

test("environment.update() reenvía los secretos del GET tal cual, sin operation", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite(
    { id: 30, project_id: 2, name: "zz", env: "{}", json: "{}", secrets: [{ id: 7, type: "var", name: "TOKEN", secret: "" }] },
    calls,
  );
  await new SemaphoreClient(CONFIG).environment.update(2, 30, { name: "otro" });
  fm.mock.restore();

  // Sin `operation` el servidor los ignora, que es lo que hace que un rename no
  // se lleve los secretos por delante.
  assert.deepEqual(putBody(calls)["secrets"], [{ id: 7, type: "var", name: "TOKEN", secret: "" }]);
});

test("templates.update() con environmentIds vacío no desengancha los grupos por accidente", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite(TEMPLATE, calls);
  await new SemaphoreClient(CONFIG).templates.update(1, 21, { name: "x" });
  fm.mock.restore();
  assert.deepEqual(putBody(calls)["environment_ids"], [1, 4], "sin tocar el campo, la lista del GET sobrevive");
});

// — superficie nueva de 0.5.0: refs, stages, ramas, posiciones —

test("refs pregunta al endpoint correcto de cada recurso", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite({ templates: [], inventories: [], repositories: [], integrations: [], schedules: [], access_keys: [] }, calls);
  const client = new SemaphoreClient(CONFIG);
  await client.keys.refs(1, 3);
  await client.repositories.refs(1, 4);
  await client.templates.refs(1, 21);
  fm.mock.restore();

  assert.deepEqual(
    calls.map((c) => c.url.replace("http://semaphore.test/api", "")),
    ["/project/1/keys/3/refs", "/project/1/repositories/4/refs", "/project/1/templates/21/refs"],
  );
});

test("schedules.setActive() usa el endpoint dedicado y no reenvía el objeto entero", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite({}, calls);
  await new SemaphoreClient(CONFIG).schedules.setActive(1, 2, false);
  fm.mock.restore();

  const put = calls.find((c) => c.method === "PUT");
  assert.ok(put?.url.endsWith("/project/1/schedules/2/active"));
  assert.deepEqual(put?.body, { active: false }, "solo el flag: ni cron, ni template_id, ni nombre");
});

test("tasks.stop() usa POST /stop, no el DELETE que borraba el registro", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite({}, calls);
  const client = new SemaphoreClient(CONFIG);
  await client.tasks.stop(1, 5);
  await client.tasks.confirm(1, 5);
  await client.tasks.reject(1, 5);
  fm.mock.restore();

  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url.replace("http://semaphore.test/api", "")}`),
    ["POST /project/1/tasks/5/stop", "POST /project/1/tasks/5/confirm", "POST /project/1/tasks/5/reject"],
  );
});

test("views.setPositions() manda el mapa de posiciones de una vez", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite({}, calls);
  await new SemaphoreClient(CONFIG).views.setPositions(1, { 3: 0, 4: 1 });
  fm.mock.restore();
  const post = calls.find((c) => c.method === "POST");
  assert.deepEqual(post?.body, { "3": 0, "4": 1 });
});

// — transporte: lo que NO es "JSON dentro, JSON fuera" —
// Estos tests existen porque el mock que devuelve JSON para todo no vio cuatro
// fallos que sí ocurrían contra el servidor real.

/** Imita al servidor: 204 sin cuerpo en las escrituras, y text/plain en raw_output. */
function mockRealistic(calls: Call[], opts?: { text?: string; emptyOk?: boolean }) {
  return mock.method(globalThis, "fetch", async (url: unknown, init: unknown) => {
    const o = (init ?? {}) as { method?: string; body?: string };
    const method = o.method ?? "GET";
    calls.push({
      method,
      url: String(url),
      body: o.body ? (JSON.parse(o.body) as Record<string, unknown>) : undefined,
    });
    if (opts?.text !== undefined) {
      return { ok: true, status: 200, statusText: "OK", text: async () => opts.text, json: async () => { throw new SyntaxError("not json"); } } as unknown as Response;
    }
    if (opts?.emptyOk === true) {
      return { ok: true, status: 200, statusText: "OK", text: async () => "", json: async () => { throw new SyntaxError("empty"); } } as unknown as Response;
    }
    return { ok: true, status: 204, statusText: "No Content", text: async () => "", json: async () => null } as Response;
  });
}

test("tasks.stop() manda cuerpo: sin él el servidor responde 400 y la task sigue corriendo", async () => {
  const calls: Call[] = [];
  const fm = mockRealistic(calls);
  await new SemaphoreClient(CONFIG).tasks.stop(1, 5);
  await new SemaphoreClient(CONFIG).tasks.stop(1, 5, { force: true });
  fm.mock.restore();

  assert.deepEqual(calls[0]?.body, { force: false }, "helpers.Bind hace Decode: un cuerpo vacío es EOF");
  assert.deepEqual(calls[1]?.body, { force: true });
});

test("templates.stopAllTasks() también manda cuerpo", async () => {
  const calls: Call[] = [];
  const fm = mockRealistic(calls);
  await new SemaphoreClient(CONFIG).templates.stopAllTasks(1, 21);
  fm.mock.restore();
  assert.deepEqual(calls[0]?.body, { force: false });
});

test("tasks.rawOutput() devuelve el texto plano del log, no intenta parsearlo", async () => {
  const calls: Call[] = [];
  const fm = mockRealistic(calls, { text: "PLAY [all] ****\nTASK [ping] ****\n" });
  const out = await new SemaphoreClient(CONFIG).tasks.rawOutput(1, 5);
  fm.mock.restore();
  assert.match(out, /PLAY \[all\]/);
});

test("un 200 con cuerpo vacío se resuelve, no se convierte en error", async () => {
  const calls: Call[] = [];
  const fm = mockRealistic(calls, { emptyOk: true });
  // El servidor no escribe nada cuando el cron es válido.
  await new SemaphoreClient(CONFIG).schedules.validate(1, "0 3 * * *");
  fm.mock.restore();
  assert.equal(calls[0]?.method, "POST");
  assert.deepEqual(calls[0]?.body, { cron_format: "0 3 * * *" });
});

test("repositories.playbooks() acepta la rama, que es lo que permite listar otra distinta", async () => {
  const calls: Call[] = [];
  const fm = mockGetThenWrite(["site.yml"], calls);
  await new SemaphoreClient(CONFIG).repositories.playbooks(1, 4, { branch: "develop" });
  fm.mock.restore();
  assert.match(calls[0]?.url ?? "", /\/repositories\/4\/playbooks\?branch=develop$/);
});

// — contrato de `--json` y de `--arguments` (hallazgos de la QA manual) —

test("tasks.stop() con force manda force:true, que es lo que el CLI no cableaba", async () => {
  const calls: Call[] = [];
  const fm = mockRealistic(calls);
  await new SemaphoreClient(CONFIG).tasks.stop(1, 5, { force: true });
  fm.mock.restore();
  assert.deepEqual(calls[0]?.body, { force: true });
});
