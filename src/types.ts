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
  /** Omitted by the API on list/get. */
  alert?: boolean;
  alert_chat?: string;
  /** Omitted by the API on list/get. */
  max_parallel_tasks?: number;
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
  /** null when the inventory has no SSH key (the API returns null, not 0). */
  ssh_key_id: number | null;
  become_key_id?: number;
  [key: string]: unknown;
}

export interface CreateInventoryInput {
  name: string;
  projectId: number;
  inventory: string;
  type: InventoryType;
  /**
   * Optional: the API accepts a static inventory with no SSH key (verified
   * against 2.19.8, which returns 201 and ssh_key_id null). Required in
   * practice only when the inventory itself needs credentials.
   */
  sshKeyId?: number;
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

/**
 * Ansible-specific template settings (`task_params` in the API).
 *
 * The override flags matter at run time: Semaphore accepts a task overriding
 * limit/inventory/tags and stores it, but the executor only applies the override
 * when the corresponding flag is on (services/tasks/local_executor.go).
 */
export interface AnsibleTemplateParams {
  allow_debug?: boolean;
  allow_override_inventory?: boolean;
  allow_override_limit?: boolean;
  allow_override_tags?: boolean;
  allow_override_skip_tags?: boolean;
  limit?: string[];
  [key: string]: unknown;
}

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
  /** Omitted by the API when false (`omitempty` server-side). */
  allow_override_args_in_task?: boolean;
  /** Omitted by the API when empty. */
  task_params?: AnsibleTemplateParams;
  description?: string;
  /** Omitted by the API for regular templates. */
  type?: TemplateType;
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
  /** Moved into `params` by the server; not returned as a top-level field. */
  debug?: boolean;
  /** Moved into `params` by the server; not returned as a top-level field. */
  dry_run?: boolean;
  playbook?: string;
  /** Serialized JSON string of extra variables used in this run. See RunTaskInput.environment. */
  environment?: string;
  /**
   * ALWAYS empty: deprecated server-side (`db:"-"`), kept only for backwards
   * compatibility. The effective value lives in `params.limit`.
   */
  limit?: string;
  /** Run parameters as stored by the server: `limit`, `debug`, `tags`… */
  params?: Record<string, unknown>;
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
  /** The API returns null when the schedule uses the template's repository. */
  repository_id?: number | null;
  /** Raw API field. The server never sends `enabled`. */
  active: boolean;
  /** Normalized alias of `active`, filled in by this client. */
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

/** Result of `GET /user`: the user the API token belongs to. */
export interface CurrentUser extends User {
  /** Whether the user may create projects (global setting + admin flag). */
  can_create_project?: boolean;
  external?: boolean;
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

/** Result of `GET /project/{id}/role`: the caller's role in that project. */
export interface ProjectRole {
  role: ProjectUserRole;
  /** Permission bitmask; see `ProjectPermission` in `permissions.ts`. */
  permissions: number;
}

export interface ProjectUser {
  id: number;
  /** Not returned when listing the members of a project. */
  project_id?: number;
  name: string;
  username: string;
  /** Not returned when listing the members of a project. */
  email?: string;
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

// ── Workflows ──
// Requires Semaphore >= 2.19. The API surface exists in older versions only as
// a stub, so guard on the server version before calling these.
export type WorkflowNodeKind = "task" | "approval" | "note";
export type WorkflowEdgeCondition = "on_success" | "on_failure" | "always";
export type WorkflowConvergenceMode = "all" | "any";
export type WorkflowRunStatus = "running" | "approval" | "success" | "stopped" | "failed";
export type WorkflowApprovalStatus = "pending" | "approved" | "rejected";

export interface WorkflowNode {
  id: number;
  workflow_template_id: number;
  /** Only for kind "task". */
  template_id?: number;
  kind: WorkflowNodeKind;
  convergence_mode?: WorkflowConvergenceMode;
  /** Only for kind "approval": seconds before the gate times out. */
  approval_timeout?: number;
  approval_message?: string;
  /** Only for kind "note". */
  note?: string;
  position_x: number;
  position_y: number;
  [key: string]: unknown;
}

export interface WorkflowEdge {
  id: number;
  workflow_template_id: number;
  source_node_id: number;
  destination_node_id: number;
  condition: WorkflowEdgeCondition;
  [key: string]: unknown;
}

export interface Workflow {
  id: number;
  project_id: number;
  name: string;
  description?: string;
  start_version?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  last_run?: WorkflowRun;
  [key: string]: unknown;
}

/**
 * Node as accepted by create/update.
 *
 * `id` is a CLIENT-SIDE id used only to wire the edges: the server remaps it to
 * the real one on save. It is mandatory as soon as the graph has an edge — the
 * API rejects the payload with "workflow edge source node does not belong to
 * workflow" if the edge points at a node with no id (verified on 2.19.8).
 */
export interface WorkflowNodeInput {
  id?: number;
  kind: WorkflowNodeKind;
  templateId?: number;
  convergenceMode?: WorkflowConvergenceMode;
  approvalTimeout?: number;
  approvalMessage?: string;
  note?: string;
  positionX?: number;
  positionY?: number;
}

export interface WorkflowEdgeInput {
  sourceNodeId: number;
  destinationNodeId: number;
  condition: WorkflowEdgeCondition;
}

export interface CreateWorkflowInput {
  projectId: number;
  name: string;
  description?: string;
  /** The server rejects an empty graph and requires exactly one root node. */
  nodes: WorkflowNodeInput[];
  edges?: WorkflowEdgeInput[];
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  nodes?: WorkflowNodeInput[];
  edges?: WorkflowEdgeInput[];
}

export interface WorkflowRun {
  id: number;
  project_id: number;
  workflow_template_id: number;
  status: WorkflowRunStatus;
  version?: string;
  start?: string;
  end?: string;
  /** Task id of the first node, useful to follow the run with `tasks output`. */
  root_task_id?: number;
  [key: string]: unknown;
}

export interface WorkflowApproval {
  id: number;
  project_id: number;
  workflow_run_id: number;
  workflow_node_id: number;
  status: WorkflowApprovalStatus;
  created: string;
  resolved?: string;
  resolved_by_user_id?: number;
  [key: string]: unknown;
}

// ── Project backup ──
export interface ProjectBackup {
  meta?: Record<string, unknown>;
  templates?: unknown[];
  repositories?: unknown[];
  inventories?: unknown[];
  environments?: unknown[];
  keys?: unknown[];
  views?: unknown[];
  schedules?: unknown[];
  [key: string]: unknown;
}
