import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type { ObjectReferrers, Repository, CreateRepositoryInput, UpdateRepositoryInput } from "../types.js";
import { mergeForUpdate, readForUpdate } from "./merge.js";

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

  /**
   * Partial update: reads the repository and sends it back whole, because the
   * server's PUT is full-replace (see `merge.ts`). Changing just the branch used
   * to blank the URL and the SSH key.
   */
  async update(projectId: number, repoId: number, input: UpdateRepositoryInput): Promise<void> {
    const existing = await readForUpdate<Repository>(this.request, `/project/${projectId}/repositories/${repoId}`, "Repository", repoId);

    await this.request(`/project/${projectId}/repositories/${repoId}`, {
      method: "PUT",
      body: mergeForUpdate(existing, {
        id: repoId,
        project_id: projectId,
        name: input.name,
        git_url: input.gitUrl,
        git_branch: input.gitBranch,
        ssh_key_id: input.sshKeyId,
      }),
    });
  }

  /** The branches the server can see in the repository. */
  async branches(projectId: number, repoId: number): Promise<string[]> {
    return this.request<string[]>(`/project/${projectId}/repositories/${repoId}/branches`);
  }

  /** The playbooks/scripts found in it, which is what a template's `playbook` points at. */
  async playbooks(projectId: number, repoId: number, options?: { branch?: string }): Promise<string[]> {
    // Sin `branch` el servidor mira la rama configurada en el repositorio, que
    // es justo lo que impide listar los playbooks de otra rama.
    return this.request<string[]>(`/project/${projectId}/repositories/${repoId}/playbooks`, {
      ...(options?.branch !== undefined && { params: { branch: options.branch } }),
    });
  }

  /** What references this repository. Ask before deleting it. */
  async refs(projectId: number, repoId: number): Promise<ObjectReferrers> {
    return this.request<ObjectReferrers>(`/project/${projectId}/repositories/${repoId}/refs`);
  }

  async delete(projectId: number, repoId: number): Promise<void> {
    await this.request(`/project/${projectId}/repositories/${repoId}`, { method: "DELETE" });
  }
}
