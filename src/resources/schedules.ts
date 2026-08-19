import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type { Schedule, CreateScheduleInput, UpdateScheduleInput } from "../types.js";

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
        cron_format: input.cronFormat,
        ...(input.repositoryId !== undefined && { repository_id: input.repositoryId }),
        ...(input.enabled !== undefined && { active: input.enabled }),
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
    const existing = await this.get(projectId, scheduleId);
    if (existing === null) {
      throw new SemaphoreApiError(404, "Not Found", undefined, `Schedule ${scheduleId} not found`);
    }

    const repositoryId = input.repositoryId ?? existing.repository_id;

    await this.request(`/project/${projectId}/schedules/${scheduleId}`, {
      method: "PUT",
      body: {
        id: scheduleId,
        project_id: projectId,
        template_id: input.templateId ?? existing.template_id,
        cron_format: input.cronFormat ?? existing.cron_format,
        active: input.enabled ?? existing.enabled,
        ...(repositoryId !== undefined && repositoryId !== null && { repository_id: repositoryId }),
      },
    });
  }

  async delete(projectId: number, scheduleId: number): Promise<void> {
    await this.request(`/project/${projectId}/schedules/${scheduleId}`, { method: "DELETE" });
  }
}
