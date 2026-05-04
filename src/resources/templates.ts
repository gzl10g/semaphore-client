import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type { Template, CreateTemplateInput, UpdateTemplateInput } from "../types.js";

export class TemplatesResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: number): Promise<Template[]> {
    return this.request<Template[]>(`/project/${projectId}/templates`);
  }

  async get(projectId: number, templateId: number): Promise<Template | null> {
    try {
      return await this.request<Template>(`/project/${projectId}/templates/${templateId}`);
    } catch (e) {
      if (e instanceof SemaphoreApiError && e.isNotFound) return null;
      throw e;
    }
  }

  async create(input: CreateTemplateInput): Promise<Template> {
    return this.request<Template>(`/project/${input.projectId}/templates`, {
      method: "POST",
      body: {
        name: input.name,
        project_id: input.projectId,
        inventory_id: input.inventoryId,
        repository_id: input.repositoryId,
        environment_id: input.environmentId,
        playbook: input.playbook,
        app: input.app ?? "ansible",
        type: input.type ?? "",
        allow_override_args_in_task: input.allowOverrideArgsInTask ?? false,
        ...(input.vaultKeyId !== undefined && { vault_key_id: input.vaultKeyId }),
        ...(input.viewId !== undefined && { view_id: input.viewId }),
        ...(input.arguments !== undefined && { arguments: input.arguments }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.startVersion !== undefined && { start_version: input.startVersion }),
        ...(input.buildVersionTemplate !== undefined && { build_version_template: input.buildVersionTemplate }),
      },
    });
  }

  async update(projectId: number, templateId: number, input: UpdateTemplateInput): Promise<void> {
    await this.request(`/project/${projectId}/templates/${templateId}`, {
      method: "PUT",
      body: {
        id: templateId,
        project_id: projectId,
        ...(input.name !== undefined && { name: input.name }),
        ...(input.inventoryId !== undefined && { inventory_id: input.inventoryId }),
        ...(input.repositoryId !== undefined && { repository_id: input.repositoryId }),
        ...(input.environmentId !== undefined && { environment_id: input.environmentId }),
        ...(input.playbook !== undefined && { playbook: input.playbook }),
        ...(input.app !== undefined && { app: input.app }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.vaultKeyId !== undefined && { vault_key_id: input.vaultKeyId }),
        ...(input.viewId !== undefined && { view_id: input.viewId }),
        ...(input.arguments !== undefined && { arguments: input.arguments }),
        ...(input.allowOverrideArgsInTask !== undefined && { allow_override_args_in_task: input.allowOverrideArgsInTask }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.startVersion !== undefined && { start_version: input.startVersion }),
        ...(input.buildVersionTemplate !== undefined && { build_version_template: input.buildVersionTemplate }),
      },
    });
  }

  async delete(projectId: number, templateId: number): Promise<void> {
    await this.request(`/project/${projectId}/templates/${templateId}`, { method: "DELETE" });
  }
}
