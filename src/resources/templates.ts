import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type {
  Template,
  CreateTemplateInput,
  UpdateTemplateInput,
  ObjectReferrers,
  Schedule,
  Task,
} from "../types.js";
import { mergeForUpdate, readForUpdate } from "./merge.js";

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
        ...(input.inventoryId !== undefined && { inventory_id: input.inventoryId }),
        repository_id: input.repositoryId,
        environment_id: input.environmentId,
        playbook: input.playbook,
        app: input.app ?? "ansible",
        type: input.type ?? "",
        allow_override_args_in_task: input.allowOverrideArgsInTask ?? false,
        environment_ids: input.environmentIds ?? [input.environmentId],
        ...(input.viewId !== undefined && { view_id: input.viewId }),
        ...(input.arguments !== undefined && { arguments: input.arguments }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.startVersion !== undefined && { start_version: input.startVersion }),
        ...(input.buildTemplateId !== undefined && { build_template_id: input.buildTemplateId }),
        ...(input.gitBranch !== undefined && { git_branch: input.gitBranch }),
        ...(input.vaults !== undefined && { vaults: input.vaults }),
        ...(input.surveyVars !== undefined && { survey_vars: input.surveyVars }),
        ...(input.taskParams !== undefined && { task_params: input.taskParams }),
        ...(input.autorun !== undefined && { autorun: input.autorun }),
        ...(input.allowParallelTasks !== undefined && { allow_parallel_tasks: input.allowParallelTasks }),
        ...(input.suppressSuccessAlerts !== undefined && { suppress_success_alerts: input.suppressSuccessAlerts }),
        ...(input.allowOverrideBranchInTask !== undefined && { allow_override_branch_in_task: input.allowOverrideBranchInTask }),
        ...(input.runnerTag !== undefined && { runner_tag: input.runnerTag }),
      },
    });
  }

  /**
   * Partial update: reads the template and sends it back whole, because the
   * server's PUT is full-replace (see `merge.ts`). Without this, renaming a
   * template erased its `survey_vars`, `task_params`, `autorun` and vaults — and
   * dropping `app` from the body answered 400 `Invalid app id`.
   */
  async update(projectId: number, templateId: number, input: UpdateTemplateInput): Promise<void> {
    const existing = await readForUpdate<Template>(this.request, `/project/${projectId}/templates/${templateId}`, "Template", templateId);

    /**
     * `environment_ids` is the source of truth (table `project__template_environment`);
     * `environment_id` is the legacy field, and the server only falls back to it
     * when `environment_ids` is absent (`Template.ApplyLegacyEnvironmentField`).
     * Since the merged body always carries `environment_ids`, changing only
     * `environmentId` would be silently ignored.
     */
    const environmentIds =
      input.environmentIds ??
      (input.environmentId !== undefined ? [input.environmentId] : undefined);

    await this.request(`/project/${projectId}/templates/${templateId}`, {
      method: "PUT",
      body: mergeForUpdate(existing, {
        id: templateId,
        project_id: projectId,
        name: input.name,
        inventory_id: input.inventoryId,
        repository_id: input.repositoryId,
        environment_id: input.environmentId,
        environment_ids: environmentIds,
        playbook: input.playbook,
        app: input.app,
        type: input.type,
        view_id: input.viewId,
        arguments: input.arguments,
        allow_override_args_in_task: input.allowOverrideArgsInTask,
        description: input.description,
        start_version: input.startVersion,
        build_template_id: input.buildTemplateId,
        git_branch: input.gitBranch,
        vaults: input.vaults,
        survey_vars: input.surveyVars,
        task_params: input.taskParams,
        autorun: input.autorun,
        allow_parallel_tasks: input.allowParallelTasks,
        suppress_success_alerts: input.suppressSuccessAlerts,
        allow_override_branch_in_task: input.allowOverrideBranchInTask,
        runner_tag: input.runnerTag,
      }),
    });
  }

  /** Renames nothing else: the only partial write the server offers for a template. */
  async setDescription(projectId: number, templateId: number, description: string): Promise<void> {
    await this.request(`/project/${projectId}/templates/${templateId}/description`, {
      method: "PUT",
      body: { description },
    });
  }

  /** What references this template (schedules, integrations…). Ask before deleting. */
  async refs(projectId: number, templateId: number): Promise<ObjectReferrers> {
    return this.request<ObjectReferrers>(`/project/${projectId}/templates/${templateId}/refs`);
  }

  /** The schedules that fire this template. */
  async schedules(projectId: number, templateId: number): Promise<Schedule[]> {
    return this.request<Schedule[]>(`/project/${projectId}/templates/${templateId}/schedules`);
  }

  async tasks(projectId: number, templateId: number): Promise<Task[]> {
    return this.request<Task[]>(`/project/${projectId}/templates/${templateId}/tasks`);
  }

  async lastTasks(projectId: number, templateId: number): Promise<Task[]> {
    return this.request<Task[]>(`/project/${projectId}/templates/${templateId}/tasks/last`);
  }

  /** Stops every running task of this template in one call. */
  async stopAllTasks(projectId: number, templateId: number, options?: { force?: boolean }): Promise<void> {
    // Mismo Bind que `tasks.stop`: sin cuerpo, 400 "Not allowed".
    await this.request(`/project/${projectId}/templates/${templateId}/stop_all_tasks`, {
      method: "POST",
      body: { force: options?.force ?? false },
    });
  }

  /** Aggregate stats of the template's runs. */
  async stats(projectId: number, templateId: number): Promise<unknown> {
    return this.request<unknown>(`/project/${projectId}/templates/${templateId}/stats`);
  }

  /** Attaches an extra inventory to the template (a template can offer several). */
  async attachInventory(projectId: number, templateId: number, inventoryId: number): Promise<void> {
    await this.request(`/project/${projectId}/templates/${templateId}/inventory/${inventoryId}/attach`, { method: "POST" });
  }

  async detachInventory(projectId: number, templateId: number, inventoryId: number): Promise<void> {
    await this.request(`/project/${projectId}/templates/${templateId}/inventory/${inventoryId}/detach`, { method: "POST" });
  }

  async setDefaultInventory(projectId: number, templateId: number, inventoryId: number): Promise<void> {
    await this.request(`/project/${projectId}/templates/${templateId}/inventory/${inventoryId}/set_default`, { method: "POST" });
  }

  async delete(projectId: number, templateId: number): Promise<void> {
    await this.request(`/project/${projectId}/templates/${templateId}`, { method: "DELETE" });
  }
}
