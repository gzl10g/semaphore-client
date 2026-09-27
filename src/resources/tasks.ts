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

/**
 * Copies `params.dry_run` to the top level, where callers look for it. Since
 * 2.14 the server keeps it only inside `params`, so a task created as a check
 * and one that ran for real read the same: no `dry_run` anywhere visible.
 * A top-level `dry_run` from a server older than 2.14 is kept.
 */
export function normalizeTask<T extends Task>(raw: T): T {
  // Un 2xx sin cuerpo llega como undefined: se devuelve tal cual, como antes.
  if (raw == null) return raw;
  return { ...raw, dry_run: raw.params?.["dry_run"] === true || raw.dry_run === true };
}

export class TasksResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: number, options?: ListTasksOptions): Promise<Task[]> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params["limit"] = String(options.limit);
    if (options?.start !== undefined) params["start"] = String(options.start);
    if (options?.status !== undefined) params["status"] = options.status;
    const tasks = await this.request<Task[]>(`/project/${projectId}/tasks`, {
      params: Object.keys(params).length > 0 ? params : undefined,
      signal: options?.signal,
    });
    // El servidor NO filtra por `status` (`GetAllTasks` solo lee sort/order):
    // devolvía todas las tasks a quien pedía las fallidas. Se filtra aquí.
    const filtered = options?.status !== undefined ? tasks.filter((t) => t.status === options.status) : tasks;
    return filtered.map(normalizeTask);
  }

  async get(projectId: number, taskId: number): Promise<Task | null> {
    try {
      return normalizeTask(await this.request<Task>(`/project/${projectId}/tasks/${taskId}`));
    } catch (e) {
      if (e instanceof SemaphoreApiError && e.isNotFound) return null;
      // Semaphore < 2.9 quirk: returns 400 with "Invalid task id" instead of 404 for nonexistent tasks.
      if (e instanceof SemaphoreApiError && e.status === 400 && typeof e.body === "string" && e.body.includes("Invalid task id")) return null;
      // 2.19 answers a task that does not exist with a 400 and NO body
      // (`GetTaskMiddleware`: "Cannot get task from database"), measured on
      // 2.19.12. The id is a number here, so the other 400 of that middleware
      // (an id that is not an integer) cannot happen.
      if (e instanceof SemaphoreApiError && e.status === 400 && (e.body === undefined || e.body === "")) return null;
      throw e;
    }
  }

  /**
   * `debug` and `dry_run` go in `params`: since 2.14 `db.Task` has no top-level
   * field for them, the decoder drops them without a word and the executor
   * reads `params` (`AnsibleTaskParams`). Sent only at the top level, a
   * `--dry-run` ran for real. They are also kept at the top level for servers
   * older than 2.14, which read them there; newer ones ignore that copy.
   */
  async run(projectId: number, input: RunTaskInput): Promise<Task> {
    const debug = input.debug ?? false;
    const dryRun = input.dryRun ?? false;
    const task = await this.request<Task>(`/project/${projectId}/tasks`, {
      method: "POST",
      body: {
        template_id: input.templateId,
        debug,
        dry_run: dryRun,
        params: {
          debug,
          dry_run: dryRun,
          ...(input.diff !== undefined && { diff: input.diff }),
          ...(input.debugLevel !== undefined && { debug_level: input.debugLevel }),
          ...(input.tags !== undefined && { tags: input.tags }),
          ...(input.skipTags !== undefined && { skip_tags: input.skipTags }),
          ...(input.plan !== undefined && { plan: input.plan }),
          ...(input.destroy !== undefined && { destroy: input.destroy }),
          ...(input.autoApprove !== undefined && { auto_approve: input.autoApprove }),
          ...(input.upgrade !== undefined && { upgrade: input.upgrade }),
          ...(input.reconfigure !== undefined && { reconfigure: input.reconfigure }),
        },
        ...(input.playbook !== undefined && { playbook: input.playbook }),
        ...(input.environment !== undefined && { environment: input.environment }),
        ...(input.limit !== undefined && { limit: input.limit }),
        ...(input.arguments !== undefined && { arguments: input.arguments }),
        ...(input.inventoryId !== undefined && { inventory_id: input.inventoryId }),
        ...(input.gitBranch !== undefined && { git_branch: input.gitBranch }),
        ...(input.message !== undefined && { message: input.message }),
        ...(input.buildTaskId !== undefined && { build_task_id: input.buildTaskId }),
      },
    });
    return normalizeTask(task);
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

  /**
   * The last tasks of the project, newest first — and the only real pagination
   * the API has (`list()` ignores `limit`/`start`). `limit` is the page size
   * (the server caps it at 200, and 200 is its default); `before` is a task id,
   * and only older tasks come back. Measured on 2.19.12: `limit=3` → 22,21,20;
   * `limit=3, before=10` → 9,8,7. Keep paging with the last id until a page
   * comes back shorter than `limit`.
   */
  async last(projectId: number, options?: { limit?: number; before?: number; signal?: AbortSignal }): Promise<Task[]> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params["limit"] = String(options.limit);
    if (options?.before !== undefined) params["before"] = String(options.before);
    const tasks = await this.request<Task[]>(`/project/${projectId}/tasks/last`, {
      ...(Object.keys(params).length > 0 && { params }),
      signal: options?.signal,
    });
    return tasks.map(normalizeTask);
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
    let seen = false;

    while (true) {
      if (signal?.aborted) throw new SemaphoreApiError(0, "Aborted", "ABORTED");

      const task = await this.get(projectId, taskId);
      if (task === null) {
        // `get()` también da null ante el 400 sin cuerpo con que 2.19 contesta
        // CUALQUIER fallo de BD en ese endpoint. Si la task ya se vio, no es que
        // no exista: es que no se pudo leer, y decir "not found" invitaba a
        // relanzar una task que sigue corriendo. Sin status, como un corte de red.
        if (seen) {
          throw new SemaphoreApiError(0, `Task ${taskId} could not be read any more (the server answered 400 or 404); it may still be running.`);
        }
        throw new SemaphoreApiError(404, "Task not found");
      }
      seen = true;
      options?.onPoll?.(task);
      if (task.status === "rejected") {
        throw new SemaphoreApiError(0, `Task ${taskId} was rejected: its approval was denied, so it will never run.`, "REJECTED");
      }
      if (task.status === "waiting_confirmation" && onWaitingConfirmation === "throw") {
        throw new SemaphoreApiError(0, `Task ${taskId} is waiting for approval and will not start until somebody approves it.`, "WAITING_CONFIRMATION");
      }
      if (terminal.includes(task.status)) return task;

      // Después de leer, no antes: un timeout comprobado tras dormir declaraba
      // "sigue corriendo" una task que ya había terminado en ese intervalo.
      if (timeout !== undefined && Date.now() - start > timeout) {
        throw new SemaphoreApiError(0, `Timeout waiting for task ${taskId} after ${timeout}ms. The task may still be running — call tasks.stop() to cancel it.`, "TIMEOUT");
      }

      await new Promise<void>((resolve) => setTimeout(resolve, pollInterval));
    }
  }
}
