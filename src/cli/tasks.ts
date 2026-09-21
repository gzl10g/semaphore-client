import * as readline from "node:readline";
import type { SemaphoreClient } from "../client.js";
import type { AnsibleTemplateParams, RunTaskInput, TaskStatus, Template } from "../types.js";
import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  formatOutput,
  reportMutation,
  validateArgumentsShape,
  resolveProject,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";

const TASKS_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 6 },
  { key: "template_id", label: "Template ID", width: 12 },
  { key: "status", label: "Status", width: 10 },
  { key: "created", label: "Created", width: 20 },
] as const;

function resolveClient(deps?: HandlerDeps) {
  if (deps?.client) return deps.client;
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  return buildClient(config);
}

function getProjectId(projectFlag: number | undefined, deps?: HandlerDeps): number {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  return resolveProject({
    flag: projectFlag,
    env: process.env["SMPHE_PROJECT"],
    config,
  });
}

export async function handleTasksList(
  projectFlag: number | undefined,
  opts: { json?: boolean; status?: string },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const tasks = await client.tasks.list(projectId, { status: opts.status as TaskStatus | undefined });
  formatOutput(tasks, opts, TASKS_COLUMNS);
}

export async function handleTasksGet(
  projectFlag: number | undefined,
  taskId: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const task = await client.tasks.get(projectId, taskId);
  if (task === null) {
    throw new Error("Task not found");
  }
  formatOutput(task, opts);
}

export interface RunTaskOpts {
  debug?: boolean;
  dryRun?: boolean;
  playbook?: string;
  environment?: string;
  limit?: string;
  arguments?: string;
}

export async function handleTasksRun(
  projectFlag: number | undefined,
  templateId: number,
  runOpts: RunTaskOpts,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  // Primera pasada sin `app`: acepta las dos formas y rechaza lo que no es
  // ninguna. La comprobación contra el app real está en assertOverridesAreHonoured,
  // que ya lee la plantilla — aquí todavía no se tiene.
  validateArgumentsShape(runOpts.arguments);

  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);

  await assertOverridesAreHonoured(client, projectId, templateId, runOpts);

  const input: RunTaskInput = {
    templateId,
    debug: runOpts.debug,
    dryRun: runOpts.dryRun,
    playbook: runOpts.playbook,
    environment: runOpts.environment,
    limit: runOpts.limit,
    arguments: runOpts.arguments,
  };
  const task = await client.tasks.run(projectId, input);
  formatOutput(task, opts);
}

/**
 * Refuses to run a task whose overrides the server would silently drop.
 *
 * Semaphore stores limit/arguments/debug on the task and answers 201, but the
 * executor only applies each one when the template enables it
 * (services/tasks/local_executor.go). The failure mode is nasty and silent: a
 * playbook meant for one host runs on the whole inventory, extra arguments
 * vanish, `--debug` produces no verbose output — with no error anywhere.
 *
 * `--playbook`, `--environment` and `--dry-run` need no flag: they always apply.
 *
 * If the template cannot be read, the run proceeds: an unverifiable check must
 * not block work that used to run.
 */
async function assertOverridesAreHonoured(
  client: SemaphoreClient,
  projectId: number,
  templateId: number,
  runOpts: RunTaskOpts,
): Promise<void> {
  const requested: { flag: string; allowedBy: string; allowed: (p: AnsibleTemplateParams, t: Template) => boolean }[] = [];
  if (runOpts.limit !== undefined) {
    requested.push({ flag: "--limit", allowedBy: "Allow override limit in task", allowed: (p) => p.allow_override_limit === true });
  }
  if (runOpts.arguments !== undefined) {
    requested.push({ flag: "--arguments", allowedBy: "Allow override args in task", allowed: (_p, t) => t.allow_override_args_in_task === true });
  }
  if (runOpts.debug === true) {
    requested.push({ flag: "--debug", allowedBy: "Allow debug", allowed: (p) => p.allow_debug === true });
  }
  if (requested.length === 0) return;

  // try/catch, not .catch(): a client without the resource throws synchronously.
  let template: Template | null = null;
  try {
    template = await client.templates.get(projectId, templateId);
  } catch {
    return;
  }
  if (template === null) return;

  // Ahora sí se conoce el app: un mapa de stages en una plantilla ansible se
  // acepta, responde 201 y revienta al ejecutar con "invalid format of the
  // TaskRunner extra arguments" — el fallo silencioso que esta función existe
  // para evitar.
  validateArgumentsShape(runOpts.arguments, template.app);

  const params = template.task_params ?? {};
  const dropped = requested.filter((r) => !r.allowed(params, template));
  if (dropped.length === 0) return;

  const lines = [
    `Template ${templateId} ("${template.name}") would silently ignore ` +
      `${dropped.map((d) => d.flag).join(", ")}: Semaphore accepts the task and then runs it without them.`,
  ];
  for (const d of dropped) {
    lines.push(`  ${d.flag}: enable "${d.allowedBy}" in the template settings.`);
  }
  // task_params es una unión por `app`: el limit solo existe en la variante ansible.
  const configured = (params as AnsibleTemplateParams).limit;
  if (configured?.length && dropped.some((d) => d.flag === "--limit")) {
    lines.push(`  The template runs with its own limit: ${configured.join(", ")}.`);
  } else if (dropped.some((d) => d.flag === "--limit")) {
    lines.push("  The template has no limit of its own: every host of the inventory would run.");
  }
  throw new Error(lines.join("\n"));
}

export async function handleTasksStop(
  projectFlag: number | undefined,
  taskId: number,
  opts: { json?: boolean; force?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.tasks.stop(projectId, taskId, { force: opts.force });
  reportMutation(opts, {
    message: `Task ${taskId} ${opts.force === true ? "killed" : "stopped"}`,
    id: taskId,
    ...(opts.force === true && { force: true }),
  });
}

export async function handleTasksOutput(
  projectFlag: number | undefined,
  taskId: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const lines = await client.tasks.output(projectId, taskId);
  if (opts.json) {
    console.log(JSON.stringify(lines, null, 2));
    return;
  }
  for (const line of lines) {
    console.log(`[${line.time}] ${line.output}`);
  }
}

function askConfirmation(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

export { askConfirmation as _askConfirmation };

export async function handleTasksConfirm(
  projectFlag: number | undefined,
  taskId: number,
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.tasks.confirm(projectId, taskId);
  console.log(`Task ${taskId} approved`);
}

export async function handleTasksReject(
  projectFlag: number | undefined,
  taskId: number,
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.tasks.reject(projectId, taskId);
  console.log(`Task ${taskId} rejected: it will not run`);
}

export async function handleTasksStages(
  projectFlag: number | undefined,
  taskId: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  formatOutput(await client.tasks.stages(getProjectId(projectFlag, deps), taskId), opts);
}

export async function handleTasksHosts(
  projectFlag: number | undefined,
  taskId: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  formatOutput(await client.tasks.ansibleHosts(getProjectId(projectFlag, deps), taskId), opts);
}
