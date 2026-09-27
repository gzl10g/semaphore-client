import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";

/**
 * Semaphore's PUT handlers bind the whole struct and persist it (see
 * `api/projects/templates.go`), so a partial body is not a partial update: every
 * field left out is written back as its zero value. Renaming a template used to
 * erase its `survey_vars`, `environment_ids` and `task_params`; changing a cron
 * used to pause the schedule.
 *
 * So `update()` reads the object first and sends it back whole. The merge keeps
 * every field the server sent — including the ones this client does not type and
 * the ones Semaphore adds in later versions — and overwrites only what the caller
 * asked to change.
 */

/**
 * Fields the API returns on GET but the PUT must not receive: joined data from
 * other tables (`tpl_*`, `user_name`, `last_task`), server-computed counters
 * (`tasks`, `permissions`) and this client's own normalized alias (`enabled`,
 * see `SchedulesResource`).
 */
export const DERIVED_FIELDS = [
  "last_task",
  "tasks",
  "permissions",
  "tpl_alias",
  "tpl_app",
  "tpl_name",
  "tpl_playbook",
  "user_name",
  "enabled",
] as const;

/**
 * Builds the full body for a PUT: the object as the server returned it, minus
 * derived fields, with `changes` applied on top. Keys whose value is `undefined`
 * are dropped, so callers can spread optional input without wiping a field.
 */
export function mergeForUpdate(
  existing: Record<string, unknown>,
  changes: Record<string, unknown>,
  extraDerived: readonly string[] = [],
): Record<string, unknown> {
  const drop = new Set<string>([...DERIVED_FIELDS, ...extraDerived]);
  const body: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(existing)) {
    if (drop.has(k) || v === undefined) continue;
    body[k] = v;
  }
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined) continue;
    body[k] = v;
  }

  return body;
}

/**
 * The 404 an `update()` throws when the object it was asked to merge is gone.
 * `id` is a string for the resources the API keys by name instead of by number
 * (global roles by slug, apps by app id).
 */
export function notFound(resource: string, id: number | string): SemaphoreApiError {
  return new SemaphoreApiError(404, "Not Found", undefined, `${resource} ${id} not found`);
}

/**
 * The read every `update()` does before merging. It exists to keep that extra
 * GET from lying about what failed:
 *
 * - a 404 becomes the `notFound()` of the object the caller named;
 * - a 403 is reported as the PUT it was about to be, because permission hints
 *   ignore reads (the server lets every project member read, so a denied GET
 *   carries no permission to explain);
 * - a 2xx with no object is an unusable answer, not a missing object — saying
 *   "not found" about something that exists sends people down the wrong path.
 */
export async function readForUpdate<T>(
  request: RequestFn,
  endpoint: string,
  resource: string,
  id: number | string,
): Promise<T> {
  let existing: T | undefined;

  try {
    existing = await request<T>(endpoint);
  } catch (e) {
    if (e instanceof SemaphoreApiError && e.isNotFound) throw notFound(resource, id);
    if (e instanceof SemaphoreApiError && e.isPermission) {
      throw new SemaphoreApiError(e.status, e.statusText, e.code, e.body, "PUT", endpoint);
    }
    throw e;
  }

  if (existing == null) {
    throw new SemaphoreApiError(
      0,
      `${resource} ${id} could not be read before updating: the server answered without a body`,
      undefined,
      undefined,
      "GET",
      endpoint,
    );
  }

  return existing;
}
