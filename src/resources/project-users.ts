import type { RequestFn } from "../client.js";
import type { ProjectUser, AddProjectUserInput, UpdateProjectUserInput } from "../types.js";

export class ProjectUsersResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: number): Promise<ProjectUser[]> {
    return this.request<ProjectUser[]>(`/project/${projectId}/users`);
  }

  async add(projectId: number, input: AddProjectUserInput): Promise<ProjectUser> {
    return this.request<ProjectUser>(`/project/${projectId}/users`, {
      method: "POST",
      body: {
        user_id: input.userId,
        role: input.role,
      },
    });
  }

  async update(projectId: number, userId: number, input: UpdateProjectUserInput): Promise<void> {
    await this.request(`/project/${projectId}/users/${userId}`, {
      method: "PUT",
      body: {
        user_id: userId,
        role: input.role,
      },
    });
  }

  async remove(projectId: number, userId: number): Promise<void> {
    await this.request(`/project/${projectId}/users/${userId}`, { method: "DELETE" });
  }
}
