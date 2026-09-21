import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type { Inventory, CreateInventoryInput, UpdateInventoryInput, ObjectReferrers } from "../types.js";
import { mergeForUpdate, readForUpdate } from "./merge.js";

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
        ...(input.sshKeyId !== undefined && { ssh_key_id: input.sshKeyId }),
        ...(input.becomeKeyId !== undefined && { become_key_id: input.becomeKeyId }),
      },
    });
  }

  /**
   * Partial update: reads the inventory and sends it back whole, because the
   * server's PUT is full-replace (see `merge.ts`). Renaming an inventory used to
   * reset its `type`, its keys and its `repository_id`/`template_id` binding.
   */
  async update(projectId: number, inventoryId: number, input: UpdateInventoryInput): Promise<void> {
    const existing = await readForUpdate<Inventory>(this.request, `/project/${projectId}/inventory/${inventoryId}`, "Inventory", inventoryId);

    await this.request(`/project/${projectId}/inventory/${inventoryId}`, {
      method: "PUT",
      body: mergeForUpdate(existing, {
        id: inventoryId,
        project_id: projectId,
        name: input.name,
        inventory: input.inventory,
        type: input.type,
        ssh_key_id: input.sshKeyId,
        become_key_id: input.becomeKeyId,
      }),
    });
  }

  /** What references it. Ask before deleting. */
  async refs(projectId: number, inventoryId: number): Promise<ObjectReferrers> {
    return this.request<ObjectReferrers>(`/project/${projectId}/inventory/${inventoryId}/refs`);
  }

  async delete(projectId: number, inventoryId: number): Promise<void> {
    await this.request(`/project/${projectId}/inventory/${inventoryId}`, { method: "DELETE" });
  }
}
