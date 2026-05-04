import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type { Inventory, CreateInventoryInput, UpdateInventoryInput } from "../types.js";

export class InventoryResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: number): Promise<Inventory[]> {
    return this.request<Inventory[]>(`/project/${projectId}/inventory`);
  }

  async get(projectId: number, inventoryId: number): Promise<Inventory | null> {
    try {
      return await this.request<Inventory>(`/project/${projectId}/inventory/${inventoryId}`);
    } catch (e) {
      if (e instanceof SemaphoreApiError && e.isNotFound) return null;
      throw e;
    }
  }

  async create(input: CreateInventoryInput): Promise<Inventory> {
    return this.request<Inventory>(`/project/${input.projectId}/inventory`, {
      method: "POST",
      body: {
        name: input.name,
        project_id: input.projectId,
        inventory: input.inventory,
        type: input.type,
        ssh_key_id: input.sshKeyId,
        ...(input.becomeKeyId !== undefined && { become_key_id: input.becomeKeyId }),
      },
    });
  }

  async update(projectId: number, inventoryId: number, input: UpdateInventoryInput): Promise<void> {
    await this.request(`/project/${projectId}/inventory/${inventoryId}`, {
      method: "PUT",
      body: {
        id: inventoryId,
        project_id: projectId,
        ...(input.name !== undefined && { name: input.name }),
        ...(input.inventory !== undefined && { inventory: input.inventory }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.sshKeyId !== undefined && { ssh_key_id: input.sshKeyId }),
        ...(input.becomeKeyId !== undefined && { become_key_id: input.becomeKeyId }),
      },
    });
  }

  async delete(projectId: number, inventoryId: number): Promise<void> {
    await this.request(`/project/${projectId}/inventory/${inventoryId}`, { method: "DELETE" });
  }
}
