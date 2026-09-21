import type { RequestFn } from "../client.js";
import type { PooledTask } from "../types.js";

/**
 * The instance-wide task pool (`/tasks`, admin only).
 *
 * This is deliberately NOT called `tasks`: `client.tasks` is the per-project
 * task history that lives in the database, and this is something else. The
 * admin handler reads the server's in-memory pool and reports only what is
 * **queued or running right now** (`api/tasks/tasks.go`), with a `location`
 * saying which of the two. A finished task is not here — it never was.
 *
 * `location` is not `status`: the pool moves a task into `running` as soon as
 * it picks it up, so a task reports `location: "running"` while its `status` is
 * still `waiting`. Verified on v2.19.12 against a real task.
 */
export class InstanceTasksResource {
  constructor(private readonly request: RequestFn) {}

  /** Everything queued or running across every project. */
  async list(): Promise<PooledTask[]> {
    return this.request<PooledTask[]>("/tasks");
  }

  /** The ones waiting for a slot. */
  async listQueued(): Promise<PooledTask[]> {
    return (await this.list()).filter((t) => t.location === "queue");
  }

  /** The ones executing. */
  async listRunning(): Promise<PooledTask[]> {
    return (await this.list()).filter((t) => t.location === "running");
  }

  /**
   * Stops a queued or running task.
   *
   * The endpoint is spelled `DELETE /tasks/{id}` but it deletes nothing: it
   * calls `pool.StopTask`, so the task stays in the history with its status.
   * And it answers **204 whether or not the id was in the pool** — the handler
   * simply skips the stop when it finds nothing. A 204 is therefore not
   * evidence that anything was stopped; compare `list()` before and after.
   */
  async stop(taskId: number): Promise<void> {
    await this.request(`/tasks/${taskId}`, { method: "DELETE" });
  }
}
