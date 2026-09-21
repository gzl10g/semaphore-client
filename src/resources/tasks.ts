import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type {
  Task,
  TaskStatus,
  TaskStage,
  AnsibleTaskHost,
  AnsibleTaskError,
  RunTaskInput,
  TaskOutput,
  ListTasksOptions,
  WaitForCompletionOptions,
} from "../types.js";

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

  /**
   * Stops a running task (`POST /tasks/{id}/stop`).
   *
   * It used to send `DELETE /project/{id}/tasks/{id}`, which deletes the task
   * record — and the handler refuses to delete a queued or running task, so the
   * call answered 400 and the task kept running to completion.
   */
  async stop(projectId: number, taskId: number, options?: { force?: boolean }): Promise<void> {
    // El cuerpo NO es opcional: `StopTask` hace `helpers.Bind`, que es un
    // Decode sobre el body, y un body vacío es EOF -> 400 antes de tocar nada.
    await this.request(`/project/${projectId}/tasks/${taskId}/stop`, {
      method: "POST",
      body: { force: options?.force ?? false },
    });
  }

  /** Approves a task waiting at an approval gate (`waiting_confirmation`). */
  async confirm(projectId: number, taskId: number): Promise<void> {
    await this.request(`/project/${projectId}/tasks/${taskId}/confirm`, { method: "POST" });
  }

  /** Rejects it, which is final: the task never runs. */
  async reject(projectId: number, taskId: number): Promise<void> {
    await this.request(`/project/${projectId}/tasks/${taskId}/reject`, { method: "POST" });
  }

  /** Deletes the task record itself. Not the same as stopping it. */
  async delete(projectId: number, taskId: number): Promise<void> {
    await this.request(`/project/${projectId}/tasks/${taskId}`, { method: "DELETE" });
  }

  async output(projectId: number, taskId: number): Promise<TaskOutput[]> {
    return this.request<TaskOutput[]>(`/project/${projectId}/tasks/${taskId}/output`);
  }

  /** The output as the server stores it, unsplit: one blob instead of lines. */
  async rawOutput(projectId: number, taskId: number): Promise<string> {
    // El servidor responde `text/plain`, no JSON.
    return this.request<string>(`/project/${projectId}/tasks/${taskId}/raw_output`, {
      responseType: "text",
    });
  }

  /** The stages the run went through (checkout, galaxy install, the playbook…). */
  async stages(projectId: number, taskId: number): Promise<TaskStage[]> {
    return this.request<TaskStage[]>(`/project/${projectId}/tasks/${taskId}/stages`);
  }

  /** Per-host counters as ansible reported them: the PLAY RECAP, without parsing the log. */
  async ansibleHosts(projectId: number, taskId: number): Promise<AnsibleTaskHost[]> {
    return this.request<AnsibleTaskHost[]>(`/project/${projectId}/tasks/${taskId}/ansible/hosts`);
  }

  /** The errors ansible recorded for the run. */
  async ansibleErrors(projectId: number, taskId: number): Promise<AnsibleTaskError[]> {
    return this.request<AnsibleTaskError[]>(`/project/${projectId}/tasks/${taskId}/ansible/errors`);
  }

  /** The last tasks of the project, which is what the dashboard shows. */
  async last(projectId: number, options?: { limit?: number; signal?: AbortSignal }): Promise<Task[]> {
    return this.request<Task[]>(`/project/${projectId}/tasks/last`, {
      ...(options?.limit !== undefined && { params: { limit: String(options.limit) } }),
      signal: options?.signal,
    });
  }

  /**
   * Polls until the task reaches one of the three statuses the server considers
   * final (`success`, `error`, `stopped` — `IsFinished()` in `pkg/task_logger`).
   *
   * Two statuses never reach that set on their own: a rejected approval stays
   * `rejected` forever, and `waiting_confirmation` lasts until a human approves.
   * Polling them silently is how a wait without `timeout` becomes an infinite
   * loop, so `rejected` throws and `waiting_confirmation` is configurable.
   */
  async waitForCompletion(projectId: number, taskId: number, options?: WaitForCompletionOptions): Promise<Task> {
    const pollInterval = options?.pollInterval ?? 2_000;
    const timeout = options?.timeout;
    const signal = options?.signal;
    const onWaitingConfirmation = options?.onWaitingConfirmation ?? "wait";
    const start = Date.now();
    const terminal: TaskStatus[] = ["success", "error", "stopped"];

    while (true) {
      if (signal?.aborted) throw new SemaphoreApiError(0, "Aborted");
      if (timeout !== undefined && Date.now() - start > timeout) {
        throw new SemaphoreApiError(0, `Timeout waiting for task ${taskId} after ${timeout}ms. The task may still be running — call tasks.stop() to cancel it.`);
      }

      const task = await this.get(projectId, taskId);
      if (task === null) throw new SemaphoreApiError(404, "Task not found");
      if (task.status === "rejected") {
        throw new SemaphoreApiError(0, `Task ${taskId} was rejected: its approval was denied, so it will never run.`);
      }
      if (task.status === "waiting_confirmation" && onWaitingConfirmation === "throw") {
        throw new SemaphoreApiError(0, `Task ${taskId} is waiting for approval and will not start until somebody approves it.`);
      }
      if (terminal.includes(task.status)) return task;

      await new Promise<void>((resolve) => setTimeout(resolve, pollInterval));
    }
  }
}
