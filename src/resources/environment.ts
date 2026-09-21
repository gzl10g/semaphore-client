import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type {
  Environment,
  EnvironmentSecretInput,
  CreateEnvironmentInput,
  UpdateEnvironmentInput,
  ObjectReferrers,
} from "../types.js";
import { mergeForUpdate, readForUpdate } from "./merge.js";

/**
 * The server keys each entry by `operation` (`updateEnvironmentSecrets`): an
 * entry with no operation is ignored, so a missing one defaults to `create` —
 * or to `update` when the caller named an existing secret by id.
 */
function serializeSecrets(secrets: EnvironmentSecretInput[]): Record<string, unknown>[] {
  return secrets.map((s) => ({
    type: s.type,
    name: s.name,
    secret: s.secret ?? "",
    operation: s.operation ?? (s.id !== undefined ? "update" : "create"),
    ...(s.id !== undefined && { id: s.id }),
  }));
}

export class EnvironmentResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: number): Promise<Environment[]> {
    return this.request<Environment[]>(`/project/${projectId}/environment`);
  }

  async get(projectId: number, envId: number): Promise<Environment | null> {
    try {
      return await this.request<Environment>(`/project/${projectId}/environment/${envId}`);
    } catch (e) {
      if (e instanceof SemaphoreApiError && e.isNotFound) return null;
      throw e;
    }
  }

  async create(input: CreateEnvironmentInput): Promise<Environment> {
    return this.request<Environment>(`/project/${input.projectId}/environment`, {
      method: "POST",
      body: {
        name: input.name,
        project_id: input.projectId,
        ...(input.password !== undefined && { password: input.password }),
        ...(input.env !== undefined && { env: input.env }),
        ...(input.json !== undefined && { json: input.json }),
        ...(input.secrets !== undefined && { secrets: serializeSecrets(input.secrets) }),
      },
    });
  }

  /**
   * Partial update: reads the variable group and sends it back whole, because the
   * server's PUT is full-replace (see `merge.ts`). Renaming a group used to wipe
   * its variables (`env`/`json`) and its secret-storage binding.
   */
  async update(projectId: number, envId: number, input: UpdateEnvironmentInput): Promise<void> {
    const existing = await readForUpdate<Environment>(this.request, `/project/${projectId}/environment/${envId}`, "Environment", envId);

    await this.request(`/project/${projectId}/environment/${envId}`, {
      method: "PUT",
      body: mergeForUpdate(existing, {
        id: envId,
        project_id: projectId,
        name: input.name,
        password: input.password,
        env: input.env,
        json: input.json,
        // El GET devuelve los secretos sin `operation`, y el servidor ignora esas
        // entradas; solo las que manda el llamante llevan orden.
        secrets: input.secrets !== undefined ? serializeSecrets(input.secrets) : undefined,
      }),
    });
  }

  /** What references it. Ask before deleting. */
  async refs(projectId: number, envId: number): Promise<ObjectReferrers> {
    return this.request<ObjectReferrers>(`/project/${projectId}/environment/${envId}/refs`);
  }

  /** Pulls the secrets again from the secret storage bound to this group. */
  async sync(projectId: number, envId: number): Promise<void> {
    await this.request(`/project/${projectId}/environment/${envId}/sync`, { method: "POST" });
  }

  async delete(projectId: number, envId: number): Promise<void> {
    await this.request(`/project/${projectId}/environment/${envId}`, { method: "DELETE" });
  }
}
