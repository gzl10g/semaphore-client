import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type { Project, CreateProjectInput, UpdateProjectInput } from "../types.js";
import { ProjectUsersResource } from "./project-users.js";

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

  async update(id: number, input: UpdateProjectInput): Promise<void> {
    await this.request(`/project/${id}`, {
      method: "PUT",
      body: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.alert !== undefined && { alert: input.alert }),
        ...(input.alertChat !== undefined && { alert_chat: input.alertChat }),
        ...(input.maxParallelTasks !== undefined && { max_parallel_tasks: input.maxParallelTasks }),
      },
    });
  }

  async delete(id: number): Promise<void> {
    await this.request(`/project/${id}`, { method: "DELETE" });
  }
}
