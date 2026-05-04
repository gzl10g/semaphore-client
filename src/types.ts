// ── Semaphore Info ──
export interface SemaphoreInfo {
  version: string;
  [key: string]: unknown;
}

// ── Config ──
export interface SemaphoreClientConfig {
  baseUrl: string;
  apiToken: string;
  timeout?: number;
  retry?: {
    maxRetries?: number;
    retryOn?: number[];
  };
  onRequest?: (req: { method: string; url: string }) => void;
  onResponse?: (res: { method: string; url: string; status: number; durationMs: number }) => void;
}

// ── Internal request ──
export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  timeout?: number;
  signal?: AbortSignal;
}

// ── Projects ──
export interface Project {
  id: number;
  name: string;
  created: string;
  alert: boolean;
  alert_chat?: string;
  max_parallel_tasks: number;
  [key: string]: unknown;
}

export interface CreateProjectInput {
  name: string;
  alert?: boolean;
  alertChat?: string;
  maxParallelTasks?: number;
}

export interface UpdateProjectInput {
  name?: string;
  alert?: boolean;
  alertChat?: string;
  maxParallelTasks?: number;
}

// ── Keys (Key Store) ──
export type KeyType = "ssh" | "login" | "none";

export interface KeySecret {
  login?: string;
  password?: string;
  privateKey?: string;
}

export interface Key {
  id: number;
  name: string;
  type: KeyType;
  project_id: number;
  [key: string]: unknown;
}

export interface CreateKeyInput {
  name: string;
  type: KeyType;
  projectId: number;
  secret?: KeySecret;
}

export interface UpdateKeyInput {
  name?: string;
  type?: KeyType;
  secret?: KeySecret;
}

// ── Repositories ──
export interface Repository {
  id: number;
  name: string;
  project_id: number;
  git_url: string;
  git_branch: string;
  ssh_key_id: number;
  [key: string]: unknown;
}

export interface CreateRepositoryInput {
  name: string;
  projectId: number;
  gitUrl: string;
  gitBranch: string;
  sshKeyId: number;
}

export interface UpdateRepositoryInput {
  name?: string;
  gitUrl?: string;
  gitBranch?: string;
  sshKeyId?: number;
}

// ── Inventory ──
export type InventoryType = "static" | "file" | "static-yaml";

export interface Inventory {
  id: number;
  name: string;
  project_id: number;
  inventory: string;
  type: InventoryType;
  ssh_key_id: number;
  become_key_id?: number;
  [key: string]: unknown;
}

export interface CreateInventoryInput {
  name: string;
  projectId: number;
  inventory: string;
  type: InventoryType;
  sshKeyId: number;
  becomeKeyId?: number;
}

export interface UpdateInventoryInput {
  name?: string;
  inventory?: string;
  type?: InventoryType;
  sshKeyId?: number;
  becomeKeyId?: number;
}

// ── Environment (Variable Groups) ──
export interface Environment {
  id: number;
  name: string;
  project_id: number;
  /**
   * Ansible-vault key used to encrypt this variable group's secrets.
   * If set, the `json` and `env` fields are encrypted with this key and required to decrypt at runtime.
   * NOT an authentication password.
   */
  password?: string;
  env?: string;
  json?: string;
  [key: string]: unknown;
}

export interface CreateEnvironmentInput {
  name: string;
  projectId: number;
  /**
   * Ansible-vault key used to encrypt this variable group's secrets.
   * If set, the `json` and `env` fields are encrypted with this key and required to decrypt at runtime.
   * NOT an authentication password.
   */
  password?: string;
  env?: string;
  json?: string;
}

export interface UpdateEnvironmentInput {
  name?: string;
  /**
   * Ansible-vault key used to encrypt this variable group's secrets.
   * If set, the `json` and `env` fields are encrypted with this key and required to decrypt at runtime.
   * NOT an authentication password.
   */
  password?: string;
  env?: string;
  json?: string;
}

// ── Templates ──
export type TemplateType = "" | "deploy" | "build";
export type TemplateApp = "ansible" | "terraform" | "tofu" | "bash" | "python" | "powershell";

export interface Template {
  id: number;
  name: string;
  project_id: number;
  inventory_id: number;
  repository_id: number;
  environment_id: number;
  app: TemplateApp;
  vault_key_id?: number;
  view_id?: number;
  playbook: string;
  arguments?: string;
  allow_override_args_in_task: boolean;
  description?: string;
  type: TemplateType;
  start_version?: string;
  build_version_template?: string;
  [key: string]: unknown;
}

export interface CreateTemplateInput {
  name: string;
  projectId: number;
  inventoryId: number;
  repositoryId: number;
  environmentId: number;
  playbook: string;
  app?: TemplateApp;
  type?: TemplateType;
  vaultKeyId?: number;
  viewId?: number;
  arguments?: string;
  allowOverrideArgsInTask?: boolean;
  description?: string;
  startVersion?: string;
  buildVersionTemplate?: string;
}

export interface UpdateTemplateInput {
  name?: string;
  inventoryId?: number;
  repositoryId?: number;
  environmentId?: number;
  playbook?: string;
  app?: TemplateApp;
  type?: TemplateType;
  vaultKeyId?: number;
  viewId?: number;
  arguments?: string;
  allowOverrideArgsInTask?: boolean;
  description?: string;
  startVersion?: string;
  buildVersionTemplate?: string;
}

// ── Tasks ──
export type TaskStatus = "waiting" | "running" | "stopped" | "error" | "success";

export interface Task {
  id: number;
  template_id: number;
  project_id: number;
  status: TaskStatus;
  debug: boolean;
  dry_run: boolean;
  playbook?: string;
  /** Serialized JSON string of extra variables used in this run. See RunTaskInput.environment. */
  environment?: string;
  limit?: string;
  created: string;
  start?: string;
  end?: string;
  message?: string;
  commit_hash?: string;
  commit_message?: string;
  build_task_id?: number;
  version?: string;
  [key: string]: unknown;
}

export interface RunTaskInput {
  templateId: number;
  debug?: boolean;
  dryRun?: boolean;
  playbook?: string;
  /**
   * Serialized JSON string of extra variables to override the template's environment for this run.
   * @example
   * environment: JSON.stringify({ ansible_user: "deploy", target_env: "prod" })
   */
  environment?: string;
  limit?: string;
  arguments?: string;
}

export interface TaskOutput {
  task_id: number;
  time: string;
  output: string;
}

export interface ListTasksOptions {
  limit?: number;
  start?: number;
  status?: TaskStatus;
  signal?: AbortSignal;
}

export interface WaitForCompletionOptions {
  /** Polling interval in milliseconds. Default: 2000. */
  pollInterval?: number;
  /**
   * Maximum wait time in milliseconds. Default: undefined (no limit).
   * WARNING: if timeout is reached, the task continues running in Semaphore.
   * Call tasks.stop() if you want to cancel it.
   */
  timeout?: number;
  signal?: AbortSignal;
}

// ── Views ──
export interface View {
  id: number;
  project_id: number;
  title: string;
  position?: number;
  [key: string]: unknown;
}

export interface CreateViewInput {
  projectId: number;
  title: string;
  position?: number;
}

export interface UpdateViewInput {
  title?: string;
  position?: number;
}

// ── Schedules ──
export interface Schedule {
  id: number;
  project_id: number;
  template_id: number;
  cron_format: string;
  repository_id?: number;
  /** Whether this schedule is active. Maps to the `active` field in the Semaphore API. */
  enabled: boolean;
  [key: string]: unknown;
}

export interface CreateScheduleInput {
  projectId: number;
  templateId: number;
  cronFormat: string;
  repositoryId?: number;
  /** Whether to create the schedule in active state. Defaults to true in the API. */
  enabled?: boolean;
}

export interface UpdateScheduleInput {
  templateId?: number;
  cronFormat?: string;
  repositoryId?: number;
  /** Activate or deactivate the schedule without deleting it. Maps to `active` in the Semaphore API. */
  enabled?: boolean;
}

// ── Users ──
export interface User {
  id: number;
  name: string;
  username: string;
  email: string;
  admin: boolean;
  created: string;
  [key: string]: unknown;
}

export interface CreateUserInput {
  name: string;
  username: string;
  email: string;
  password: string;
  admin?: boolean;
}

export interface UpdateUserInput {
  name?: string;
  username?: string;
  email?: string;
  password?: string;
  admin?: boolean;
}

// ── Project Users ──
export type ProjectUserRole = "owner" | "manager" | "task_runner" | "guest";

export interface ProjectUser {
  id: number;
  project_id: number;
  name: string;
  username: string;
  email: string;
  role: ProjectUserRole;
  [key: string]: unknown;
}

export interface AddProjectUserInput {
  userId: number;
  role: ProjectUserRole;
}

export interface UpdateProjectUserInput {
  role: ProjectUserRole;
}
