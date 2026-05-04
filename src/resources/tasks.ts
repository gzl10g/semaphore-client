import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type { Task, TaskStatus, RunTaskInput, TaskOutput, ListTasksOptions, WaitForCompletionOptions } from "../types.js";

export class TasksResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: number, options?: ListTasksOptions): Promise<Task[]> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params["limit"] = String(options.limit);
    if (options?.start !== undefined) params["start"] = String(options.start);
    if (options?.status !== undefined) params["status"] = options.status;
    return this.request<Task[]>(`/project/${projectId}/tasks`, {
      params: Object.keys(params).length > 0 ? params : undefined,
      signal: options?.signal,
    });
  }

  async get(projectId: number, taskId: number): Promise<Task | null> {
    try {
      return await this.request<Task>(`/project/${projectId}/tasks/${taskId}`);
    } catch (e) {
      if (e instanceof SemaphoreApiError && e.isNotFound) return null;
      // Semaphore < 2.9 quirk: returns 400 with "Invalid task id" instead of 404 for nonexistent tasks.
      if (e instanceof SemaphoreApiError && e.status === 400 && typeof e.body === "string" && e.body.includes("Invalid task id")) return null;
      throw e;
    }
  }

  async run(projectId: number, input: RunTaskInput): Promise<Task> {
    return this.request<Task>(`/project/${projectId}/tasks`, {
      method: "POST",
      body: {
        template_id: input.templateId,
        debug: input.debug ?? false,
        dry_run: input.dryRun ?? false,
        ...(input.playbook !== undefined && { playbook: input.playbook }),
        ...(input.environment !== undefined && { environment: input.environment }),
        ...(input.limit !== undefined && { limit: input.limit }),
        ...(input.arguments !== undefined && { arguments: input.arguments }),
      },
    });
  }

  async stop(projectId: number, taskId: number): Promise<void> {
    await this.request(`/project/${projectId}/tasks/${taskId}`, { method: "DELETE" });
  }

  async output(projectId: number, taskId: number): Promise<TaskOutput[]> {
    return this.request<TaskOutput[]>(`/project/${projectId}/tasks/${taskId}/output`);
  }

  async waitForCompletion(projectId: number, taskId: number, options?: WaitForCompletionOptions): Promise<Task> {
    const pollInterval = options?.pollInterval ?? 2_000;
    const timeout = options?.timeout;
    const signal = options?.signal;
    const start = Date.now();
    const terminal: TaskStatus[] = ["success", "error", "stopped"];

    while (true) {
      if (signal?.aborted) throw new SemaphoreApiError(0, "Aborted");
      if (timeout !== undefined && Date.now() - start > timeout) {
        throw new SemaphoreApiError(0, `Timeout waiting for task ${taskId} after ${timeout}ms. The task may still be running — call tasks.stop() to cancel it.`);
      }

      const task = await this.get(projectId, taskId);
      if (task === null) throw new SemaphoreApiError(404, "Task not found");
      if (terminal.includes(task.status)) return task;

      await new Promise<void>((resolve) => setTimeout(resolve, pollInterval));
    }
  }
}
