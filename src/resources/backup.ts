import type { RequestFn } from "../client.js";
import type { Project, ProjectBackup } from "../types.js";

/**
 * Project backup: export a whole project (templates, repositories, inventories,
 * environments, keys, views, schedules...) as JSON, and restore it as a NEW
 * project.
 *
 * Useful because Semaphore has no config-as-code (upstream issue #3109): this
 * is the only way to keep a project's configuration under version control.
 *
 * Caveat worth knowing before trusting a backup: secrets are NOT exported in
 * plain text, so a restored project needs its keys and secret values set again.
 */
export class BackupResource {
  constructor(private readonly request: RequestFn) {}

  /** Exports the project as a JSON document. */
  async export(projectId: number): Promise<ProjectBackup> {
    return this.request<ProjectBackup>(`/project/${projectId}/backup`);
  }

  /**
   * Restores a backup as a new project. Does NOT overwrite an existing one:
   * the server always creates a new project from the document.
   */
  async restore(backup: ProjectBackup): Promise<Project> {
    return this.request<Project>(`/projects/restore`, {
      method: "POST",
      body: backup as Record<string, unknown>,
    });
  }
}
