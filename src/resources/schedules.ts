import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type { Schedule, CreateScheduleInput, UpdateScheduleInput } from "../types.js";

export class SchedulesResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: number): Promise<Schedule[]> {
    return this.request<Schedule[]>(`/project/${projectId}/schedules`);
  }

  async get(projectId: number, scheduleId: number): Promise<Schedule | null> {
    try {
      return await this.request<Schedule>(`/project/${projectId}/schedules/${scheduleId}`);
    } catch (e) {
      if (e instanceof SemaphoreApiError && e.isNotFound) return null;
      throw e;
    }
  }

  async create(input: CreateScheduleInput): Promise<Schedule> {
    return this.request<Schedule>(`/project/${input.projectId}/schedules`, {
      method: "POST",
      body: {
        project_id: input.projectId,
        template_id: input.templateId,
        cron_format: input.cronFormat,
        ...(input.repositoryId !== undefined && { repository_id: input.repositoryId }),
        ...(input.enabled !== undefined && { active: input.enabled }),
      },
    });
  }

  async update(projectId: number, scheduleId: number, input: UpdateScheduleInput): Promise<void> {
    await this.request(`/project/${projectId}/schedules/${scheduleId}`, {
      method: "PUT",
      body: {
        id: scheduleId,
        project_id: projectId,
        ...(input.templateId !== undefined && { template_id: input.templateId }),
        ...(input.cronFormat !== undefined && { cron_format: input.cronFormat }),
        ...(input.repositoryId !== undefined && { repository_id: input.repositoryId }),
        ...(input.enabled !== undefined && { active: input.enabled }),
      },
    });
  }

  async delete(projectId: number, scheduleId: number): Promise<void> {
    await this.request(`/project/${projectId}/schedules/${scheduleId}`, { method: "DELETE" });
  }
}
