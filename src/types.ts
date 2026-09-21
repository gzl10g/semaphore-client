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
  /**
   * `"text"` for the endpoints that do not answer JSON — the raw task output is
   * `text/plain`, and parsing it as JSON throws on the first playbook line.
   */
  responseType?: "json" | "text";
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
  /** Omitted by the API when false (`omitempty` server-side). */
  alert?: boolean;
  alert_chat?: string;
  /** Omitted by the API when 0 (`omitempty` server-side). */
  max_parallel_tasks?: number;
  /** Empty for regular projects; set for the typed projects 2.19 introduced. */
  type?: string;
  default_secret_storage_id?: number;
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
/** The server's own set (`db/AccessKey.go`): there is no `login` type. */
export type KeyType = "ssh" | "login_password" | "string" | "none";

export interface KeySecret {
  login?: string;
  password?: string;
  privateKey?: string;
  /** Passphrase of an encrypted SSH private key. */
  passphrase?: string;
  /** The value of a `string` key (a token, an API key…). */
  string?: string;
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
export type InventoryType =
  | "static"
  | "file"
  | "static-yaml"
  | "terraform-workspace"
  | "tofu-workspace"
  | "terragrunt-workspace";

export interface Inventory {
  id: number;
  name: string;
  project_id: number;
  inventory: string;
  type: InventoryType;
  /** null when the inventory has no SSH key (the API returns null, not 0). */
  ssh_key_id: number | null;
  become_key_id?: number;
  /** Set when the inventory belongs to a template or comes from a repository. */
  template_id?: number;
  repository_id?: number;
  runner_tag?: string;
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

/**
 * Where a secret lands in the variable group (`db/Environment.go`):
 * `var` is an extra variable (ansible `--extra-vars`), `env` an environment
 * variable. The plain counterparts are the `json` and `env` fields.
 */
export type EnvironmentSecretType = "var" | "env";

/** What the server does with the entry. Omitted means `create`. */
export type EnvironmentSecretOperation = "create" | "update" | "delete";

/** A secret as the API returns it: named, typed, and without its value. */
export interface EnvironmentSecret {
  id: number;
  type: EnvironmentSecretType;
  name: string;
  /** Always empty on read: the material never leaves the server. */
  secret?: string;
  [key: string]: unknown;
}

export interface EnvironmentSecretInput {
  type: EnvironmentSecretType;
  name: string;
  /** Required to create or update; ignored when deleting. */
  secret?: string;
  /** Required to update or delete an existing secret. */
  id?: number;
  operation?: EnvironmentSecretOperation;
}
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
  /** Named secrets, without their values. Write them through the inputs' `secrets`. */
  secrets?: EnvironmentSecret[];
  secret_storage_id?: number;
  secret_storage_key_prefix?: string;
  sync_enabled?: boolean;
  sync_interval?: number;
  sync_paths?: unknown;
  last_synced_at?: string;
  last_sync_failed_at?: string;
  [key: string]: unknown;
}

export interface CreateEnvironmentInput {
  name: string;
  projectId: number;
  /** Secret extra variables (`type: "var"`) and secret environment variables (`type: "env"`). */
  secrets?: EnvironmentSecretInput[];
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
   * Secrets to create, update or delete. Entries without `operation` are
   * created, or updated when they carry the `id` of an existing secret.
   */
  secrets?: EnvironmentSecretInput[];
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
/**
 * The apps the server has configured (`GET /apps`): the built-in ones, plus
 * whatever the instance adds under "Applications" — hence the open union, which
 * keeps the autocomplete without rejecting a custom id.
 */
export type TemplateApp =
  | "ansible"
  | "terraform"
  | "terragrunt"
  | "tofu"
  | "bash"
  | "python"
  | "powershell"
  | (string & {});

/** An app as `GET /apps` returns it. */
export interface App {
  id: string;
  active: boolean;
  priority: number;
  title?: string;
  icon?: string;
  color?: string;
  dark_color?: string;
  path?: string;
  args?: string[] | null;
  [key: string]: unknown;
}

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
  /** The template's own values; a task may override them if the flag above is on. */
  limit?: string[];
  tags?: string[];
  skip_tags?: string[];
  /** Skip the Galaxy role/collection install before the playbook runs. */
  skip_galaxy_install?: boolean;
  allow_override_skip_galaxy_install?: boolean;
  [key: string]: unknown;
}

/** `task_params` of a terraform/tofu/terragrunt template. */
export interface TerraformTemplateParams {
  allow_destroy?: boolean;
  allow_auto_approve?: boolean;
  auto_approve?: boolean;
  override_backend?: boolean;
  [key: string]: unknown;
}

/** Whatever the template's `app` dictates. */
export type TemplateTaskParams = AnsibleTemplateParams | TerraformTemplateParams;

/** A vault the template unlocks at run time (`vaults` in the API). */
export interface TemplateVault {
  id?: number;
  project_id?: number;
  template_id?: number;
  name?: string;
  type?: string;
  vault_key_id?: number;
  script?: string;
  [key: string]: unknown;
}

/** One question asked before a run (`survey_vars` in the API). */
export interface SurveyVar {
  name: string;
  title?: string;
  required?: boolean;
  type?: string;
  description?: string;
  values?: { name: string; value: string }[];
  [key: string]: unknown;
}

export interface Template {
  id: number;
  name: string;
  project_id: number;
  inventory_id: number;
  repository_id: number;
  /**
   * Legacy single-environment field: the server fills it with
   * `environment_ids[0]` on read and only honours it on write when
   * `environment_ids` is absent (`Template.ApplyLegacyEnvironmentField`).
   */
  environment_id: number;
  /** Source of truth for the template's variable groups since 2.19. */
  environment_ids?: number[];
  app: TemplateApp;
  view_id?: number;
  playbook: string;
  arguments?: string;
  /** Omitted by the API when false (`omitempty` server-side). */
  allow_override_args_in_task?: boolean;
  /** Omitted by the API when empty. Its shape follows the template's `app`. */
  task_params?: TemplateTaskParams;
  description?: string;
  /** Omitted by the API for regular templates. */
  type?: TemplateType;
  start_version?: string;
  /** The build template a deploy template depends on. */
  build_template_id?: number;
  vaults?: TemplateVault[];
  survey_vars?: SurveyVar[];
  autorun?: boolean;
  git_branch?: string;
  runner_tag?: string;
  allow_override_branch_in_task?: boolean;
  allow_parallel_tasks?: boolean;
  suppress_success_alerts?: boolean;
  jwt_params?: unknown;
  [key: string]: unknown;
}

export interface CreateTemplateInput {
  name: string;
  projectId: number;
  /**
   * Only ansible templates need one: `Template.Validate()` demands it for
   * `app: "ansible"` and for nothing else, so a bash/python/terraform template
   * is created without inventory — as the UI does.
   */
  inventoryId?: number;
  repositoryId: number;
  /** Shorthand for a single variable group; sent as `environment_ids: [id]`. */
  environmentId: number;
  /** Several variable groups at once (2.19+). Takes precedence over `environmentId`. */
  environmentIds?: number[];
  playbook: string;
  app?: TemplateApp;
  type?: TemplateType;
  viewId?: number;
  arguments?: string;
  allowOverrideArgsInTask?: boolean;
  description?: string;
  startVersion?: string;
  buildTemplateId?: number;
  gitBranch?: string;
  vaults?: TemplateVault[];
  surveyVars?: SurveyVar[];
  taskParams?: TemplateTaskParams;
  /** Run the template automatically when the repository gets a new commit. */
  autorun?: boolean;
  allowParallelTasks?: boolean;
  suppressSuccessAlerts?: boolean;
  /** Let a task pick the branch (the "Branch" prompt in the UI). */
  allowOverrideBranchInTask?: boolean;
  /** Pin the template to runners carrying this tag. */
  runnerTag?: string;
}

export interface UpdateTemplateInput {
  name?: string;
  inventoryId?: number;
  repositoryId?: number;
  /** Replaces the template's variable groups with this single one. */
  environmentId?: number;
  environmentIds?: number[];
  playbook?: string;
  app?: TemplateApp;
  type?: TemplateType;
  viewId?: number;
  arguments?: string;
  allowOverrideArgsInTask?: boolean;
  description?: string;
  startVersion?: string;
  buildTemplateId?: number;
  gitBranch?: string;
  vaults?: TemplateVault[];
  surveyVars?: SurveyVar[];
  taskParams?: TemplateTaskParams;
  autorun?: boolean;
  allowParallelTasks?: boolean;
  suppressSuccessAlerts?: boolean;
  allowOverrideBranchInTask?: boolean;
  runnerTag?: string;
}

// ── Tasks ──
/**
 * Every status the server can report (`pkg/task_logger`). Only `success`,
 * `error` and `stopped` are final (`IsFinished()`): a task in
 * `waiting_confirmation` or `rejected` stays there until somebody acts on it.
 */
export type TaskStatus =
  | "waiting"
  | "starting"
  | "waiting_confirmation"
  | "confirmed"
  | "rejected"
  | "running"
  | "stopping"
  | "stopped"
  | "error"
  | "success";

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
  /** Set when the task was started by a schedule, an integration or a workflow. */
  schedule_id?: number;
  integration_id?: number;
  workflow_run_id?: number;
  workflow_node_id?: number;
  inventory_id?: number;
  git_branch?: string;
  artifacts?: unknown;
  user_id?: number;
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
  /**
   * What to do while the task sits in `waiting_confirmation` (a workflow
   * approval gate). `"wait"` (default) keeps polling until somebody approves or
   * rejects it; `"throw"` returns control instead of waiting on a human.
   */
  onWaitingConfirmation?: "wait" | "throw";
}

// ── Referencias entre objetos ──
/** What points at an object (`db/Store.go`). Worth asking before deleting one. */
export interface ObjectReferrer {
  id: number;
  name: string;
}

export interface ObjectReferrers {
  templates: ObjectReferrer[];
  inventories: ObjectReferrer[];
  repositories: ObjectReferrer[];
  integrations: ObjectReferrer[];
  schedules: ObjectReferrer[];
  access_keys: ObjectReferrer[];
  [key: string]: unknown;
}

/** One stage of a task's execution (`GET /tasks/{id}/stages`). */
export interface TaskStage {
  id?: number;
  task_id?: number;
  type?: string;
  start?: string;
  end?: string;
  /** The handler serializes `TaskStageWithResult`, so these travel too. */
  result?: unknown;
  start_output_id?: number;
  end_output_id?: number;
  [key: string]: unknown;
}

/** A host as ansible reported it for a task. */
export interface AnsibleTaskHost {
  host?: string;
  ok?: number;
  changed?: number;
  failed?: number;
  unreachable?: number;
  skipped?: number;
  ignored?: number;
  rescued?: number;
  [key: string]: unknown;
}

/** An error ansible recorded for a task (`db/ansible.go`). */
export interface AnsibleTaskError {
  host?: string;
  task?: string;
  error?: string;
  created?: string;
  [key: string]: unknown;
}

/** Something that happened in the project or the instance (`GET /events`). */
export interface Event {
  user_id?: number | null;
  project_id?: number | null;
  integration_id?: number | null;
  object_id?: number | null;
  object_type?: string | null;
  object_name?: string;
  project_name?: string | null;
  username?: string | null;
  description?: string | null;
  created: string;
  [key: string]: unknown;
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
/** `""` is the cron schedule; `"run_at"` runs once at a given time (`db/Schedule.go`). */
export type ScheduleType = "" | "run_at";
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
  name?: string;
  type?: ScheduleType;
  delete_after_run?: boolean;
  /** Only for `run_at` schedules: when it fires. */
  run_at?: string;
  task_params?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CreateScheduleInput {
  projectId: number;
  templateId: number;
  /** Required for a cron schedule; ignored (and cleared by the server) for `run_at`. */
  cronFormat?: string;
  name?: string;
  /**
   * `"run_at"` makes it a one-shot schedule and requires `runAt`; the default
   * (`""`) is the recurring cron one.
   */
  type?: ScheduleType;
  /** ISO timestamp, and the server refuses it if it is not in the future. */
  runAt?: string;
  /** Delete the schedule once it has run. */
  deleteAfterRun?: boolean;
  repositoryId?: number;
  /**
   * Whether the schedule starts active. Defaults to `true` here, because the
   * API defaults to false: a schedule created without it never fires.
   */
  enabled?: boolean;
}

export interface UpdateScheduleInput {
  templateId?: number;
  cronFormat?: string;
  name?: string;
  type?: ScheduleType;
  runAt?: string;
  deleteAfterRun?: boolean;
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

// ── Integrations ──
// A webhook entry point: an external POST to `/api/integrations/{alias}` runs a
// template. `matchers` decide which requests fire it and `values` turn parts of
// the request into task variables. Types mirror `db/Integration.go` (v2.19.8).

/** `""` means the endpoint is open — anyone who knows the alias can fire it. */
export type IntegrationAuthMethod = "" | "github" | "token" | "hmac" | "bitbucket" | "basic";
export type IntegrationMatchType = "header" | "body";
export type IntegrationMatchMethod = "equals" | "unequals" | "contains";
export type IntegrationBodyDataType = "json" | "string";
/**
 * What a matcher or an extract value actually holds. The server stores `""`
 * when the source is a header — there is no body to parse — and sends it back
 * that way, so the domain types cannot promise one of the two real values.
 */
export type StoredBodyDataType = IntegrationBodyDataType | "";
export type IntegrationValueSource = "body" | "header";
/** Where the extracted value lands: an env var of the task, or a task param. */
export type IntegrationVariableType = "environment" | "task";

/** Task defaults the integration applies when it fires (`db/TaskParams.go`). */
export interface IntegrationTaskParams {
  environment?: string;
  arguments?: string;
  git_branch?: string;
  message?: string;
  version?: string;
  inventory_id?: number;
  params?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Integration {
  id: number;
  name: string;
  project_id: number;
  template_id: number;
  auth_method: IntegrationAuthMethod;
  /** Key holding the shared secret; required by every method except `""`. */
  auth_secret_id?: number | null;
  /** Header carrying the signature/token, for `token` and `hmac`. */
  auth_header: string;
  /**
   * Decides which alias reaches it, and the two options exclude each other:
   * `false` means only its own alias fires it and its matchers are ignored;
   * `true` means its own alias stops answering and it is reachable only through
   * the project-wide alias, which picks it by matchers.
   */
  searchable: boolean;
  task_params?: IntegrationTaskParams;
  [key: string]: unknown;
}

export interface CreateIntegrationInput {
  projectId: number;
  name: string;
  templateId: number;
  authMethod?: IntegrationAuthMethod;
  authSecretId?: number;
  authHeader?: string;
  searchable?: boolean;
  taskParams?: IntegrationTaskParams;
}

export interface UpdateIntegrationInput {
  name?: string;
  templateId?: number;
  authMethod?: IntegrationAuthMethod;
  /** `undefined` keeps the current key, `null` detaches it, a number sets it. */
  authSecretId?: number | null;
  authHeader?: string;
  searchable?: boolean;
  taskParams?: IntegrationTaskParams;
}

export interface IntegrationMatcher {
  id: number;
  integration_id: number;
  name: string;
  match_type: IntegrationMatchType;
  method: IntegrationMatchMethod;
  /** Only meaningful when `match_type` is `body`; `""` for a header matcher. */
  body_data_type: StoredBodyDataType;
  key: string;
  value: string;
  [key: string]: unknown;
}

/** The server validates all four: a matcher without key or value is a 400. */
export interface CreateIntegrationMatcherInput {
  name: string;
  matchType: IntegrationMatchType;
  method: IntegrationMatchMethod;
  key: string;
  value: string;
  bodyDataType?: IntegrationBodyDataType;
}

export interface UpdateIntegrationMatcherInput {
  name?: string;
  matchType?: IntegrationMatchType;
  method?: IntegrationMatchMethod;
  key?: string;
  value?: string;
  bodyDataType?: IntegrationBodyDataType;
}

export interface IntegrationExtractValue {
  id: number;
  integration_id: number;
  name: string;
  value_source: IntegrationValueSource;
  /** `""` when `value_source` is `header`. */
  body_data_type: StoredBodyDataType;
  key: string;
  /** Name the value gets inside the task. */
  variable: string;
  variable_type: IntegrationVariableType;
  [key: string]: unknown;
}

export interface CreateIntegrationExtractValueInput {
  name: string;
  valueSource: IntegrationValueSource;
  /** Required when `valueSource` is `body`; ignored for `header`. */
  bodyDataType?: IntegrationBodyDataType;
  /** Required for `header`, and for `body` when the data type is `json`. */
  key?: string;
  variable: string;
  variableType: IntegrationVariableType;
}

export interface UpdateIntegrationExtractValueInput {
  name?: string;
  valueSource?: IntegrationValueSource;
  bodyDataType?: IntegrationBodyDataType;
  key?: string;
  variable?: string;
  variableType?: IntegrationVariableType;
}

/**
 * The public URL an integration answers on.
 *
 * The server never lets the caller choose it: `AddIntegrationAlias` generates a
 * random 16-character string and the JSON it returns carries only `id` and
 * `url` (`db.IntegrationAlias.Alias` is `json:"-"`). `alias` is added by this
 * client from the last segment of that URL, which is the value the webhook
 * caller actually needs.
 */
export interface IntegrationAlias {
  id: number;
  url: string;
  alias: string;
  [key: string]: unknown;
}

/** `{id, name}` pairs of the objects pointing at something. */
export interface ObjectReferrer {
  id: number;
  name: string;
  [key: string]: unknown;
}

/**
 * `GET /integrations/{id}/refs`. Both lists come back `null` on 2.19.8: the
 * store method is a stub whose body is commented out
 * (`SqlDb.GetIntegrationRefs`, `db/sql/integration.go`), so it answers the zero
 * struct no matter how many matchers and values the integration has.
 */
export interface IntegrationRefs {
  matchers: ObjectReferrer[] | null;
  values: ObjectReferrer[] | null;
  [key: string]: unknown;
}

/**
 * What a matcher or an extract value belongs to (`.../refs`). Unlike
 * `IntegrationRefs` this endpoint is really implemented; observed answering
 * `{"integrations": []}` on 2.19.8.
 */
export interface IntegrationChildRefs {
  integrations: ObjectReferrer[];
  [key: string]: unknown;
}

// ── Admin surface ──
// Everything under `/api` behind the admin middleware. A token whose user is
// not a global admin gets 403 with an empty body on all of it.

/**
 * What `update()` may change on an app. The app's own id is not in here: it is
 * the key, and `PUT /apps/{id}` on an unknown one creates it.
 */
export interface UpdateAppInput {
  title?: string;
  icon?: string;
  color?: string;
  darkColor?: string;
  path?: string;
  args?: string[] | null;
  priority?: number;
  active?: boolean;
}

/** A global role (`/roles`). `project_id` is null for the global ones. */
export interface GlobalRole {
  slug: string;
  name: string;
  /** Bitmask, same bits as `ProjectPermission`. */
  permissions: number;
  project_id?: number | null;
  [key: string]: unknown;
}

export interface CreateGlobalRoleInput {
  slug: string;
  name: string;
  permissions?: number;
}

export interface UpdateGlobalRoleInput {
  name?: string;
  permissions?: number;
}

/** Where a task sits in the server's in-memory pool. */
export type PooledTaskLocation = "queue" | "running";

/**
 * A task as the instance-wide endpoint reports it. This is NOT a `Task`: it
 * comes from the running/queued pool, not from the database, and carries only
 * what the pool knows.
 */
export interface PooledTask {
  task_id: number;
  project_id: number;
  username?: string;
  runner_id?: number | null;
  /** Not implied by `location`: a picked-up task reads `waiting` for a while. */
  status: TaskStatus;
  location: PooledTaskLocation;
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
