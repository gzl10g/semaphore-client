import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type { Key, CreateKeyInput, UpdateKeyInput } from "../types.js";

export class KeysResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: number): Promise<Key[]> {
    return this.request<Key[]>(`/project/${projectId}/keys`);
  }

  async get(projectId: number, keyId: number): Promise<Key | null> {
    try {
      return await this.request<Key>(`/project/${projectId}/keys/${keyId}`);
    } catch (e) {
      if (e instanceof SemaphoreApiError && e.isNotFound) return null;
      throw e;
    }
  }

  async create(input: CreateKeyInput): Promise<Key> {
    return this.request<Key>(`/project/${input.projectId}/keys`, {
      method: "POST",
      body: {
        name: input.name,
        type: input.type,
        project_id: input.projectId,
        secret: {
          login: input.secret?.login,
          password: input.secret?.password,
          private_key: input.secret?.privateKey,
        },
      },
    });
  }

  async update(projectId: number, keyId: number, input: UpdateKeyInput): Promise<void> {
    await this.request(`/project/${projectId}/keys/${keyId}`, {
      method: "PUT",
      body: {
        id: keyId,
        project_id: projectId,
        ...(input.name !== undefined && { name: input.name }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.secret !== undefined && {
          secret: {
            login: input.secret.login,
            password: input.secret.password,
            private_key: input.secret.privateKey,
          },
        }),
      },
    });
  }

  async delete(projectId: number, keyId: number): Promise<void> {
    await this.request(`/project/${projectId}/keys/${keyId}`, { method: "DELETE" });
  }
}
