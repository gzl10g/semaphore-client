import { test } from "node:test";
import assert from "node:assert/strict";
import type { SemaphoreClient } from "../../src/client.js";
import { SemaphoreApiError } from "../../src/error.js";
import { explainDenied } from "../../src/cli/permissions-hint.js";

function clientWith(role: string | null, permissions = 1): SemaphoreClient {
  return {
    users: { me: async () => ({ id: 5, username: "ci", name: "CI", admin: false }) },
    projects: { getRole: async () => (role === null ? null : { role, permissions }) },
  } as unknown as SemaphoreClient;
}

test("403 on a template write names the role, the missing permission and the fix", async () => {
  const err = new SemaphoreApiError(403, "Forbidden", undefined, undefined, "POST", "/project/1/templates");
  const hint = await explainDenied(err, clientWith("task_runner"));
  assert.ok(hint);
  assert.match(hint, /task_runner/);
  assert.match(hint, /manage_resources/);
  assert.match(hint, /manager or owner/);
  assert.match(hint, /"ci"/);
});

test("401 creating a project is explained as a permission, not an expired token", async () => {
  const err = new SemaphoreApiError(401, "Unauthorized", undefined, undefined, "POST", "/projects");
  const hint = await explainDenied(err, clientWith("task_runner"));
  assert.ok(hint);
  assert.match(hint, /not allowed to create projects/);
  assert.match(hint, /not an expired token/);
});

test("no hint for statuses that are not permission failures", async () => {
  const err = new SemaphoreApiError(404, "Not Found", undefined, undefined, "GET", "/project/1/templates/9");
  assert.equal(await explainDenied(err, clientWith("task_runner")), null);
});

test("degrades to the required permission when the server has no /role endpoint", async () => {
  const err = new SemaphoreApiError(403, "Forbidden", undefined, undefined, "POST", "/project/1/keys");
  const hint = await explainDenied(err, clientWith(null));
  assert.ok(hint);
  assert.match(hint, /manage_resources/);
  assert.doesNotMatch(hint, /has role/);
});

test("no client available: still explains the required permission", async () => {
  const err = new SemaphoreApiError(403, "Forbidden", undefined, undefined, "POST", "/project/1/templates");
  const hint = await explainDenied(err, undefined);
  assert.ok(hint);
  assert.match(hint, /manage_resources/);
});

test("a rejected token on project creation points at login, not at permissions", async () => {
  const err = new SemaphoreApiError(401, "Unauthorized", undefined, undefined, "POST", "/projects");
  const brokenToken = {
    users: { me: async () => { throw new SemaphoreApiError(401, "Unauthorized"); } },
    projects: { getRole: async () => null },
  } as unknown as SemaphoreClient;
  const hint = await explainDenied(err, brokenToken);
  assert.ok(hint);
  assert.match(hint, /expired or revoked/);
  assert.match(hint, /smphe login/);
});

// `requiredPermissionFor` solo contesta para `/project/{id}/…`, así que toda la
// superficie de administración caía a `return null` y el usuario veía
// únicamente "Semaphore API 403: Forbidden", sin forma de saber que lo que le
// falta es admin GLOBAL y no un rol de proyecto.
test("un 403 de la superficie de instancia dice que hace falta admin global", async () => {
  for (const [method, endpoint] of [
    ["GET", "/roles"],
    ["PUT", "/roles/deployer"],
    ["PUT", "/apps/ansible"],
    ["POST", "/apps/ansible/active"],
    ["GET", "/tasks"],
    ["DELETE", "/tasks/7"],
    ["GET", "/cluster/tasks"],
  ] as const) {
    const err = new SemaphoreApiError(403, "Forbidden", undefined, undefined, method, endpoint);
    const hint = await explainDenied(err, clientWith("owner", 15));
    assert.ok(hint, `sin pista para ${method} ${endpoint}`);
    assert.match(hint, /GLOBAL admin/);
    assert.match(hint, /smphe whoami/);
    // Un rol de proyecto no sirve aquí, y decir "los reads siempre pasan" sería
    // falso: en estos endpoints también se filtra la lectura.
    assert.match(hint, /even a read is gated/);
    assert.doesNotMatch(hint, /Reads are always allowed/);
  }
});

// `GET /apps` a secas lo lee cualquiera: si alguna vez diera 403 no es por
// admin global, así que no debe llevarse la pista de instancia.
test("la lista de apps no se confunde con la administración de una app", async () => {
  const err = new SemaphoreApiError(403, "Forbidden", undefined, undefined, "GET", "/apps");
  assert.equal(await explainDenied(err, clientWith("owner", 15)), null);
});

test("un 403 de proyecto sigue explicándose por rol, no por admin global", async () => {
  const err = new SemaphoreApiError(403, "Forbidden", undefined, undefined, "PUT", "/project/1/integrations/2");
  const hint = await explainDenied(err, clientWith("task_runner"));
  assert.ok(hint);
  assert.match(hint, /manage_resources/);
  assert.doesNotMatch(hint, /GLOBAL admin/);
});
