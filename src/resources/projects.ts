import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type { Project, ProjectRole, CreateProjectInput, UpdateProjectInput, Event } from "../types.js";
import { ProjectUsersResource } from "./project-users.js";
import { mergeForUpdate, readForUpdate } from "./merge.js";

export class ProjectsResource {
  readonly users: ProjectUsersResource;

  constructor(private readonly request: RequestFn) {
    this.users = new ProjectUsersResource(request);
  }

  async list(): Promise<Project[]> {
    return this.request<Project[]>("/projects");
  }

  async get(id: number): Promise<Project | null> {
    try {
      return await this.request<Project>(`/project/${id}`);
    } catch (e) {
      if (e instanceof SemaphoreApiError && e.isNotFound) return null;
      throw e;
    }
  }

  /**
   * The caller's role and permission bitmask in the project.
   *
   * Returns `null` on 404 (older servers without the endpoint) so callers can
   * degrade instead of blowing up.
   */
  async getRole(id: number): Promise<ProjectRole | null> {
    try {
      return await this.request<ProjectRole>(`/project/${id}/role`);
    } catch (e) {
      if (e instanceof SemaphoreApiError && e.isNotFound) return null;
      throw e;
    }
  }

  async create(input: CreateProjectInput): Promise<Project> {
    return this.request<Project>("/projects", {
      method: "POST",
      body: {
        name: input.name,
        alert: input.alert ?? false,
        alert_chat: input.alertChat,
        max_parallel_tasks: input.maxParallelTasks ?? 0,
      },
    });
  }

  /**
   * Partial update: reads the project and sends it back whole, because the
   * server's PUT is full-replace (see `merge.ts`). Renaming a project used to
   * reset its alert settings and its parallel-task limit.
   */
  async update(id: number, input: UpdateProjectInput): Promise<void> {
    const existing = await readForUpdate<Project>(this.request, `/project/${id}`, "Project", id);

    await this.request(`/project/${id}`, {
      method: "PUT",
      body: mergeForUpdate(existing, {
        id,
        name: input.name,
        alert: input.alert,
        alert_chat: input.alertChat,
        max_parallel_tasks: input.maxParallelTasks,
      }),
    });
  }

  /** Sends a test alert through the project's configured channel (the "Test Alerts" button). */
  async testNotifications(id: number): Promise<void> {
    await this.request(`/project/${id}/notifications/test`, { method: "POST" });
  }

  /** What happened in the project, newest first. */
  async events(id: number): Promise<Event[]> {
    return this.request<Event[]>(`/project/${id}/events`);
  }

  async lastEvents(id: number): Promise<Event[]> {
    return this.request<Event[]>(`/project/${id}/events/last`);
  }

  /** Leaves the project as the current user. There is no undo from the API. */
  async leave(id: number): Promise<void> {
    await this.request(`/project/${id}/me`, { method: "DELETE" });
  }

  /**
   * Deletes the project's cached repository clones (the "Clear Cache" button of
   * the project settings). Irreversible, and the next task re-clones.
   */
  async clearCache(id: number): Promise<void> {
    await this.request(`/project/${id}/cache`, { method: "DELETE" });
  }

  async delete(id: number): Promise<void> {
    await this.request(`/project/${id}`, { method: "DELETE" });
  }
}
