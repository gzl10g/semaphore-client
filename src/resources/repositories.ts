import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type { Repository, CreateRepositoryInput, UpdateRepositoryInput } from "../types.js";

export class RepositoriesResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: number): Promise<Repository[]> {
    return this.request<Repository[]>(`/project/${projectId}/repositories`);
  }

  async get(projectId: number, repoId: number): Promise<Repository | null> {
    try {
      return await this.request<Repository>(`/project/${projectId}/repositories/${repoId}`);
    } catch (e) {
      if (e instanceof SemaphoreApiError && e.isNotFound) return null;
      throw e;
    }
  }

  async create(input: CreateRepositoryInput): Promise<Repository> {
    return this.request<Repository>(`/project/${input.projectId}/repositories`, {
      method: "POST",
      body: {
        name: input.name,
        project_id: input.projectId,
        git_url: input.gitUrl,
        git_branch: input.gitBranch,
        ssh_key_id: input.sshKeyId,
      },
    });
  }

  async update(projectId: number, repoId: number, input: UpdateRepositoryInput): Promise<void> {
    await this.request(`/project/${projectId}/repositories/${repoId}`, {
      method: "PUT",
      body: {
        id: repoId,
        project_id: projectId,
        ...(input.name !== undefined && { name: input.name }),
        ...(input.gitUrl !== undefined && { git_url: input.gitUrl }),
        ...(input.gitBranch !== undefined && { git_branch: input.gitBranch }),
        ...(input.sshKeyId !== undefined && { ssh_key_id: input.sshKeyId }),
      },
    });
  }

  async delete(projectId: number, repoId: number): Promise<void> {
    await this.request(`/project/${projectId}/repositories/${repoId}`, { method: "DELETE" });
  }
}
