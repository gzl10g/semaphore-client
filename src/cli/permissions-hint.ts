import type { SemaphoreApiError } from "../error.js";
import { describePermissions, requiredPermissionFor, rolesGranting } from "../permissions.js";
import type { SemaphoreClient } from "../client.js";

/**
 * Endpoints behind the global-admin middleware (`adminAPI` in `api/router.go`).
 *
 * They differ from the project ones in the two things that make a bare 403
 * unreadable here: no project role can grant them, and a GET is gated as well,
 * so the usual "reads are always allowed" is false. `/apps` is deliberately
 * matched only with a segment after it: the plain list is readable by anyone.
 */
const INSTANCE_ADMIN_ENDPOINT = /^\/(roles(\/|$)|apps\/|tasks(\/|$)|cluster(\/|$)|options(\/|$)|admin\/)/;

/**
 * Turns a bare 403/401 into something the user can act on.
 *
 * Semaphore answers a forbidden write with an EMPTY body, so without this the
 * CLI could only print "Semaphore API 403: Forbidden". The role lookup is done
 * only after the failure, so the happy path pays nothing.
 */
export async function explainDenied(
  err: SemaphoreApiError,
  client?: SemaphoreClient,
): Promise<string | null> {
  const endpoint = err.endpoint ?? "";
  const method = err.method ?? "";

  if (err.status === 401 && /^\/projects(\/restore)?$/.test(endpoint) && method === "POST") {
    const who = await currentUser(client);
    // A working token identifies its user, so a null here means the token itself
    // is the problem: do not send the user chasing permissions.
    if (client && who === null) {
      return "Your token was rejected: it may be expired or revoked. Run `smphe login --token <token>`.";
    }
    return [
      `Your token${who ? ` (user "${who}")` : ""} is not allowed to create projects.`,
      "This needs a global admin, or Semaphore started with NonAdminCanCreateProject enabled.",
      "This 401 is about permissions, not an expired token.",
    ].join("\n  ");
  }

  if (err.status !== 403) return null;

  // `requiredPermissionFor` only answers for `/project/{id}/…`, so without this
  // the whole admin surface fell through to `return null` and the user saw
  // nothing but "Semaphore API 403: Forbidden" — with no way to learn that what
  // is missing is GLOBAL admin and not a project role.
  if (INSTANCE_ADMIN_ENDPOINT.test(endpoint)) {
    const admin = await currentUser(client);
    return [
      `${endpoint} belongs to the instance administration, which needs a GLOBAL admin.`,
      `Your token${admin ? ` (user "${admin}")` : ""} is not one, and no project role grants this:` +
        " unlike the project endpoints, here even a read is gated.",
      "Run `smphe whoami`: it says whether your user is admin.",
    ].join("\n  ");
  }

  const required = requiredPermissionFor(method, endpoint);
  const projectId = /^\/project\/(\d+)/.exec(endpoint)?.[1];

  const lines: string[] = [];
  const who = await currentUser(client);

  if (projectId && client) {
    const role = await client.projects.getRole(Number(projectId)).catch(() => null);
    if (role) {
      lines.push(
        `Your token${who ? ` (user "${who}")` : ""} has role "${role.role}" in project ${projectId}` +
          ` (permissions: ${describePermissions(role.permissions).join(", ") || "none"}).`,
      );
    }
  }

  if (required) {
    lines.push(
      `This operation needs "${required.label}", granted by role: ` +
        `${rolesGranting(required.permission).join(" or ")}.`,
    );
  }

  if (lines.length === 0) return null;
  lines.push("Reads are always allowed; only writes are gated. Run `smphe whoami` for the full picture.");
  return lines.join("\n  ");
}

async function currentUser(client?: SemaphoreClient): Promise<string | null> {
  if (!client) return null;
  const me = await client.users.me().catch(() => null);
  return me?.username ?? null;
}
