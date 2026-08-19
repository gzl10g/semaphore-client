import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type { Environment, CreateEnvironmentInput, UpdateEnvironmentInput } from "../types.js";

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
      },
    });
  }

  async update(projectId: number, envId: number, input: UpdateEnvironmentInput): Promise<void> {
    await this.request(`/project/${projectId}/environment/${envId}`, {
      method: "PUT",
      body: {
        id: envId,
        project_id: projectId,
        ...(input.name !== undefined && { name: input.name }),
        ...(input.password !== undefined && { password: input.password }),
        ...(input.env !== undefined && { env: input.env }),
        ...(input.json !== undefined && { json: input.json }),
      },
    });
  }

  async delete(projectId: number, envId: number): Promise<void> {
    await this.request(`/project/${projectId}/environment/${envId}`, { method: "DELETE" });
  }
}
