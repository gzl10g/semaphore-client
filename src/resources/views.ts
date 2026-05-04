import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type { View, CreateViewInput, UpdateViewInput } from "../types.js";

export class ViewsResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: number): Promise<View[]> {
    return this.request<View[]>(`/project/${projectId}/views`);
  }

  async get(projectId: number, viewId: number): Promise<View | null> {
    try {
      return await this.request<View>(`/project/${projectId}/views/${viewId}`);
    } catch (e) {
      if (e instanceof SemaphoreApiError && e.isNotFound) return null;
      throw e;
    }
  }

  async create(input: CreateViewInput): Promise<View> {
    return this.request<View>(`/project/${input.projectId}/views`, {
      method: "POST",
      body: {
        project_id: input.projectId,
        title: input.title,
        ...(input.position !== undefined && { position: input.position }),
      },
    });
  }

  async update(projectId: number, viewId: number, input: UpdateViewInput): Promise<void> {
    await this.request(`/project/${projectId}/views/${viewId}`, {
      method: "PUT",
      body: {
        id: viewId,
        project_id: projectId,
        ...(input.title !== undefined && { title: input.title }),
        ...(input.position !== undefined && { position: input.position }),
      },
    });
  }

  async delete(projectId: number, viewId: number): Promise<void> {
    await this.request(`/project/${projectId}/views/${viewId}`, { method: "DELETE" });
  }
}
