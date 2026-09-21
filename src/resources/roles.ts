import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type {
  GlobalRole,
  CreateGlobalRoleInput,
  UpdateGlobalRoleInput,
} from "../types.js";
import { mergeForUpdate, readForUpdate } from "./merge.js";

/**
 * A slug goes straight into the path. `.` and `..` survive
 * `encodeURIComponent` and are then normalized away by `new URL()`, so
 * `roles.delete("..")` would send `DELETE /api/` — a request to an endpoint
 * nobody named. Everything else is left to the server to judge.
 */
function assertUsableSlug(slug: string, method: "GET" | "PUT" | "DELETE"): void {
  if (slug !== "" && slug !== "." && slug !== "..") return;
  throw new SemaphoreApiError(
    0,
    `Role slug "${slug}" cannot be used: it would resolve to a different endpoint than the one named.`,
    undefined,
    undefined,
    method,
    "/roles",
  );
}

/**
 * Global roles (`/roles`), behind the admin middleware.
 *
 * The controller comes from the PRO package (`proApi.NewRolesController`) and
 * the instance reports `custom_roles_management: false`, which reads like a
 * feature that would be off — but the endpoints work on the plain OSS image:
 * verified on v2.19.12 by creating, reading, updating and deleting a role
 * (201 / 200 / 204 / 204). The feature flag gates the UI, not the API.
 *
 * `permissions` is the same bitmask as `ProjectPermission` (`../permissions.js`).
 */
export class GlobalRolesResource {
  constructor(private readonly request: RequestFn) {}

  async list(): Promise<GlobalRole[]> {
    return this.request<GlobalRole[]>("/roles");
  }

  async get(slug: string): Promise<GlobalRole | null> {
    assertUsableSlug(slug, "GET");
    try {
      return await this.request<GlobalRole>(`/roles/${encodeURIComponent(slug)}`);
    } catch (e) {
      if (e instanceof SemaphoreApiError && e.isNotFound) return null;
      throw e;
    }
  }

  /** Answers 201 with the created role. */
  async create(input: CreateGlobalRoleInput): Promise<GlobalRole> {
    return this.request<GlobalRole>("/roles", {
      method: "POST",
      body: {
        slug: input.slug,
        name: input.name,
        permissions: input.permissions ?? 0,
      },
    });
  }

  /**
   * Partial update through read-merge-write, because this PUT is a full replace
   * like the rest of the API. Verified on v2.19.12: `PUT {"name":"x"}` answers
   * 204 and leaves the role with `permissions: 0` — renaming a role silently
   * strips everything it was allowed to do.
   */
  async update(slug: string, input: UpdateGlobalRoleInput): Promise<void> {
    assertUsableSlug(slug, "PUT");
    const endpoint = `/roles/${encodeURIComponent(slug)}`;
    const existing = await readForUpdate<GlobalRole>(this.request, endpoint, "Role", slug);

    await this.request(endpoint, {
      method: "PUT",
      body: mergeForUpdate(existing, {
        slug,
        name: input.name,
        // `permissions` is in `DERIVED_FIELDS`, and rightly so: on a project
        // object it is a counter the server computes. On a global role it is
        // the whole point of the object, so the merge would strip it and the
        // PUT would store 0. It is re-stated here, after the drop.
        permissions: input.permissions ?? existing.permissions,
      }),
    });
  }

  async delete(slug: string): Promise<void> {
    assertUsableSlug(slug, "DELETE");
    await this.request(`/roles/${encodeURIComponent(slug)}`, { method: "DELETE" });
  }
}
