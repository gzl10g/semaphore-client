import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type { Schedule, CreateScheduleInput, UpdateScheduleInput } from "../types.js";
import { mergeForUpdate, readForUpdate } from "./merge.js";

export class SchedulesResource {
  constructor(private readonly request: RequestFn) {}

  /**
   * The API field is `active`; it never sends `enabled`. Without this, reading
   * `schedule.enabled` yields undefined even though the type promises a boolean,
   * and a partial update would then silently turn the schedule off.
   */
  private normalize(raw: Schedule): Schedule {
    return { ...raw, active: raw.active, enabled: raw.active };
  }

  async list(projectId: number): Promise<Schedule[]> {
    const raw = await this.request<Schedule[]>(`/project/${projectId}/schedules`);
    return raw.map((s) => this.normalize(s));
  }

  async get(projectId: number, scheduleId: number): Promise<Schedule | null> {
    try {
      return this.normalize(
        await this.request<Schedule>(`/project/${projectId}/schedules/${scheduleId}`),
      );
    } catch (e) {
      if (e instanceof SemaphoreApiError && e.isNotFound) return null;
      throw e;
    }
  }

  async create(input: CreateScheduleInput): Promise<Schedule> {
    const created = await this.request<Schedule>(`/project/${input.projectId}/schedules`, {
      method: "POST",
      body: {
        project_id: input.projectId,
        template_id: input.templateId,
        cron_format: input.cronFormat ?? "",
        ...(input.name !== undefined && { name: input.name }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.runAt !== undefined && { run_at: input.runAt }),
        ...(input.deleteAfterRun !== undefined && { delete_after_run: input.deleteAfterRun }),
        ...(input.repositoryId !== undefined && { repository_id: input.repositoryId }),
        // El servidor NO activa por defecto: sin `active` el bool de Go es false y
        // el schedule nace inerte. Por eso el cliente manda true salvo que se pida
        // lo contrario.
        active: input.enabled ?? true,
      },
    });
    return this.normalize(created);
  }

  /**
   * Partial update. The server's PUT is full-replace and rejects a body without
   * `template_id`, so this reads the schedule first and merges — otherwise
   * changing just the cron answers 400, and any field left out is reset (which
   * silently paused the schedule, since `active` defaults to false).
   */
  async update(projectId: number, scheduleId: number, input: UpdateScheduleInput): Promise<void> {
    const existing = this.normalize(
      await readForUpdate<Schedule>(
        this.request,
        `/project/${projectId}/schedules/${scheduleId}`,
        "Schedule",
        scheduleId,
      ),
    );

    const repositoryId = input.repositoryId ?? existing.repository_id;

    // A null repository_id means "use the template's repository"; echoing the
    // null back is not the same thing, so it is left out entirely.
    const keepsTemplateRepository = repositoryId === undefined || repositoryId === null;

    await this.request(`/project/${projectId}/schedules/${scheduleId}`, {
      method: "PUT",
      body: mergeForUpdate(
        existing,
        {
          id: scheduleId,
          project_id: projectId,
          template_id: input.templateId,
          cron_format: input.cronFormat,
          name: input.name,
          type: input.type,
          run_at: input.runAt,
          delete_after_run: input.deleteAfterRun,
          active: input.enabled,
          ...(keepsTemplateRepository ? {} : { repository_id: repositoryId }),
        },
        keepsTemplateRepository ? ["repository_id"] : [],
      ),
    });
  }

  /**
   * Pauses or resumes without touching anything else (`PUT .../active`).
   * `update({ enabled })` also works, but it rewrites the whole schedule.
   */
  async setActive(projectId: number, scheduleId: number, active: boolean): Promise<void> {
    await this.request(`/project/${projectId}/schedules/${scheduleId}/active`, {
      method: "PUT",
      body: { active },
    });
  }

  /** Asks the server whether a cron expression is valid, before creating anything. */
  async validate(projectId: number, cronFormat: string): Promise<void> {
    await this.request(`/project/${projectId}/schedules/validate`, {
      method: "POST",
      body: { cron_format: cronFormat },
    });
  }

  async delete(projectId: number, scheduleId: number): Promise<void> {
    await this.request(`/project/${projectId}/schedules/${scheduleId}`, { method: "DELETE" });
  }
}
