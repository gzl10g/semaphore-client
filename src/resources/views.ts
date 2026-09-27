import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type { View, CreateViewInput, UpdateViewInput, Template } from "../types.js";
import { mergeForUpdate, readForUpdate } from "./merge.js";

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

  /**
   * Partial update: reads the view and sends it back whole, because the server's
   * PUT is full-replace (see `merge.ts`). Renaming a view used to send it to
   * position 0, reordering the whole project's tabs.
   */
  async update(projectId: number, viewId: number, input: UpdateViewInput): Promise<void> {
    const existing = await readForUpdate<View>(this.request, `/project/${projectId}/views/${viewId}`, "View", viewId);

    await this.request(`/project/${projectId}/views/${viewId}`, {
      method: "PUT",
      body: mergeForUpdate(existing, {
        id: viewId,
        project_id: projectId,
        title: input.title,
        position: input.position,
      }),
    });
  }

  /** Reorders the tabs in one call, instead of one update per view. */
  async setPositions(projectId: number, positions: Record<number, number>): Promise<void> {
    await this.request(`/project/${projectId}/views/positions`, { method: "POST", body: positions });
  }

  /** The templates that live in this view. */
  async templates(projectId: number, viewId: number): Promise<Template[]> {
    return this.request<Template[]>(`/project/${projectId}/views/${viewId}/templates`);
  }

  async delete(projectId: number, viewId: number): Promise<void> {
    await this.request(`/project/${projectId}/views/${viewId}`, { method: "DELETE" });
  }
}
