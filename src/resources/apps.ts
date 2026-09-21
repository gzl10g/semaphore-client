import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type { App, UpdateAppInput } from "../types.js";
import { mergeForUpdate } from "./merge.js";

/**
 * An app id becomes part of an option key (`apps.<id>.<field>`), and the store
 * validates those against `^[\w.]+$` (`db.ValidateOptionKey`). A hyphen — the
 * obvious way to name `my-app` — is rejected.
 *
 * The lookahead is not the server's rule but ours: `.` and `..` satisfy the
 * server's regex, and `new URL()` then normalizes them away, so
 * `delete("..")` would send `DELETE /api/` instead of `DELETE /api/apps/..`.
 * A request to an endpoint the caller did not name is worse than a rejection.
 */
const APP_ID_PATTERN = /^(?!\.{1,2}$)[\w.]+$/;

/**
 * The apps a template can use. `GET /apps` is readable by anyone; everything
 * else here is behind the admin middleware and answers 403 with an empty body
 * to a token whose user is not a global admin.
 *
 * The list is instance-wide, not per-project, so it is also the answer to "is
 * this `--app` valid here?" — `UpdateTemplate` rejects an unknown one with
 * `400 Invalid app id`.
 */
export class AppsResource {
  constructor(private readonly request: RequestFn) {}

  async list(): Promise<App[]> {
    return this.request<App[]>("/apps");
  }

  /** Only the ones the instance has enabled. */
  async listActive(): Promise<App[]> {
    return (await this.list()).filter((app) => app.active);
  }

  /**
   * One app. Note it comes back WITHOUT `id`: `getApp` serializes the config
   * entry, and only the list handler merges the map key back in. The id you
   * asked for is the id it has.
   */
  async get(appId: string): Promise<App | null> {
    try {
      return await this.request<App>(`/apps/${encodeURIComponent(appId)}`);
    } catch (e) {
      if (e instanceof SemaphoreApiError && e.isNotFound) return null;
      throw e;
    }
  }

  /**
   * Partial update, and it creates the app when `appId` is unknown — the server
   * does not validate the id against anything (`validateAppID` returns nil).
   *
   * Read-merge-write, because this PUT is a full replace like the rest of the
   * API: verified on v2.19.12 that `PUT {"title":"x"}` answers 204 and leaves
   * the app with `active: false` and `priority: 0`, i.e. renaming an app turns
   * it off.
   *
   * The id check is not decoration. `setApp` writes one option per field and
   * returns on the first rejected key, so an id the store refuses gives a 500
   * **after** having written some of the fields — and which ones is down to Go
   * map ordering, so two identical calls leave different states. Verified with
   * `smc2-app`: three identical PUTs, three different results.
   */
  async update(appId: string, input: UpdateAppInput): Promise<void> {
    assertUsableAppId(appId, "PUT");

    const endpoint = `/apps/${encodeURIComponent(appId)}`;
    // An unknown id is not an error here: this same PUT is how an app is
    // created. Only an existing one has something to merge against.
    const existing = (await this.get(appId)) ?? {};

    await this.request(endpoint, {
      method: "PUT",
      body: mergeForUpdate(
        existing as Record<string, unknown>,
        {
          title: input.title,
          icon: input.icon,
          color: input.color,
          dark_color: input.darkColor,
          path: input.path,
          args: input.args,
          priority: input.priority,
          active: input.active,
        },
      ),
    });
  }

  /**
   * Enables or disables an app without rewriting it. Unlike `update()` this
   * endpoint writes a single option, so it is the safe way to flip the switch.
   */
  async setActive(appId: string, active: boolean): Promise<void> {
    assertUsableAppId(appId, "POST");
    await this.request(`/apps/${encodeURIComponent(appId)}/active`, {
      method: "POST",
      body: { active },
    });
  }

  /**
   * Removes the app's stored options and drops it from the running config.
   * Deleting one that templates still use leaves those templates pointing at an
   * app the server no longer knows.
   */
  async delete(appId: string): Promise<void> {
    assertUsableAppId(appId, "DELETE");
    await this.request(`/apps/${encodeURIComponent(appId)}`, { method: "DELETE" });
  }
}

function assertUsableAppId(appId: string, method: "PUT" | "POST" | "DELETE"): void {
  if (APP_ID_PATTERN.test(appId)) return;
  throw new SemaphoreApiError(
    0,
    `App id "${appId}" cannot be used: it becomes part of an option key, which the server ` +
      `validates against ^[\\w.]+$ — letters, digits, underscore and dot, and cannot be "." or "..". ` +
      `A hyphen makes the write fail halfway through, with some fields already applied.`,
    undefined,
    undefined,
    method,
    `/apps/${appId}`,
  );
}
