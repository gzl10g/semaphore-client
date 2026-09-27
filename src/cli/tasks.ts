import * as readline from "node:readline";
import type { SemaphoreClient } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type { AnsibleTemplateParams, RunTaskInput, Task, TaskStatus, Template, TerraformTemplateParams } from "../types.js";
import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  ExitError,
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
  opts: { json?: boolean; status?: string; count?: number; before?: number },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  // Sin --count/--before, lo de siempre: `list()` (hasta 1000, el servidor no
  // pagina). Con ellos, la paginación real de `/tasks/last`. `--status` sigue
  // filtrando en el cliente, así que filtra DENTRO de la página.
  if (opts.count !== undefined || opts.before !== undefined) {
    const page = await client.tasks.last(projectId, { limit: opts.count, before: opts.before });
    const filtered = opts.status !== undefined ? page.filter((t) => t.status === opts.status) : page;
    formatOutput(filtered, opts, TASKS_COLUMNS);
    // El cursor sale de la página SIN filtrar: con --status puede no verse, y
    // los ids del proyecto no son consecutivos. Por stderr, para no romper --json.
    const lastId = page.at(-1)?.id;
    // 200 es la página por defecto del servidor cuando no se pasa --count.
    if (lastId !== undefined && page.length >= (opts.count ?? 200)) {
      console.error(`next page: --before ${lastId}`);
    }
    return;
  }
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
  /** Ansible verbosity 1–6; implies `debug`. */
  debugLevel?: number;
  dryRun?: boolean;
  diff?: boolean;
  playbook?: string;
  environment?: string;
  limit?: string;
  arguments?: string;
  tags?: string[];
  skipTags?: string[];
  inventoryId?: number;
  gitBranch?: string;
  message?: string;
  buildTaskId?: number;
  plan?: boolean;
  destroy?: boolean;
  autoApprove?: boolean;
  upgrade?: boolean;
  reconfigure?: boolean;
}

/** How `--wait` waits: `timeout` in seconds, `progress` prints status changes to stderr. */
export interface WaitOpts {
  timeout?: number;
  progress?: boolean;
}

/**
 * Exit codes of `tasks run --wait` and `tasks wait`. 1 stays what it always
 * was — the CLI itself failed — so a script can tell "the playbook failed"
 * from "smphe could not ask". 124 is `timeout(1)`'s.
 */
export const WAIT_EXIT_CODES = {
  success: 0,
  error: 2,
  stopped: 3,
  rejected: 4,
  timeout: 124,
} as const;

export async function handleTasksRun(
  projectFlag: number | undefined,
  templateId: number,
  runOpts: RunTaskOpts,
  opts: { json?: boolean; wait?: boolean } & WaitOpts,
  deps?: HandlerDeps,
): Promise<void> {
  // Primera pasada sin `app`: acepta las dos formas y rechaza lo que no es
  // ninguna. La comprobación contra el app real está en assertOverridesAreHonoured,
  // que ya lee la plantilla — aquí todavía no se tiene.
  validateArgumentsShape(runOpts.arguments);
  validateExtraVars(runOpts.environment);
  if (runOpts.debugLevel !== undefined && (runOpts.debugLevel < 1 || runOpts.debugLevel > 6)) {
    throw new Error(`--debug-level must be between 1 and 6 (the number of -v), got ${runOpts.debugLevel}`);
  }
  // El servidor solo lee debug_level si además va debug: sin esto, un
  // --debug-level solo se guardaba y corría sin verbosidad.
  const debug = runOpts.debug === true || runOpts.debugLevel !== undefined ? true : runOpts.debug;

  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);

  const template = await assertOverridesAreHonoured(client, projectId, templateId, { ...runOpts, debug });
  if (runOpts.inventoryId !== undefined) await assertInventoryExists(client, projectId, runOpts.inventoryId);
  const buildTaskId = await resolveBuildTask(client, projectId, template, runOpts.buildTaskId);

  const input: RunTaskInput = {
    templateId,
    debug,
    dryRun: runOpts.dryRun,
    diff: runOpts.diff,
    playbook: runOpts.playbook,
    environment: runOpts.environment,
    limit: runOpts.limit,
    arguments: runOpts.arguments,
    debugLevel: runOpts.debugLevel,
    tags: runOpts.tags,
    skipTags: runOpts.skipTags,
    inventoryId: runOpts.inventoryId,
    gitBranch: runOpts.gitBranch,
    message: runOpts.message,
    buildTaskId,
    plan: runOpts.plan,
    destroy: runOpts.destroy,
    autoApprove: runOpts.autoApprove,
    upgrade: runOpts.upgrade,
    reconfigure: runOpts.reconfigure,
  };
  const task = await client.tasks.run(projectId, input);
  if (runOpts.dryRun === true) await assertDryRunStored(client, projectId, task);

  if (opts.wait !== true) {
    formatOutput(task, opts);
    return;
  }
  // stderr: stdout lleva un solo documento, la task final, para que `| jq` funcione.
  console.error(`Task ${task.id} created, waiting for it to finish…`);
  await waitAndReport(client, projectId, task.id, opts, true);
}

/**
 * `--environment` son las extra vars de la run (ansible `--extra-vars`,
 * terraform `-var`), fundidas clave a clave sobre el JSON del variable group
 * (`populateTaskEnvironment`). Tiene que ser un OBJETO: con otra cosa el
 * servidor crea la task, la deja en `error` y responde 500 sin cuerpo
 * (medido en 2.19.12: `notjson` y `["a"]`).
 */
export function validateExtraVars(env: string | undefined): void {
  if (env === undefined) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(env);
  } catch {
    throw new Error(`--environment must be a JSON object of extra variables, e.g. '{"version":"1.2"}'. Got: ${env}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`--environment must be a JSON object of extra variables, e.g. '{"version":"1.2"}', not ${Array.isArray(parsed) ? "an array" : String(parsed)}`);
  }
}

/**
 * Semaphore sustituye un `inventory_id` que no encuentra por el de la plantilla
 * sin decir nada (`TaskRunner.populateDetails`): la run va a otros hosts. Se
 * comprueba antes, y si la lectura falla no se lanza: sin ella, un inventario
 * que no es del proyecto correría en los hosts de la plantilla.
 */
async function assertInventoryExists(client: SemaphoreClient, projectId: number, inventoryId: number): Promise<void> {
  let inventory: unknown;
  try {
    inventory = await client.inventory.get(projectId, inventoryId);
  } catch (e) {
    throw new Error(
      `Could not check that inventory ${inventoryId} belongs to project ${projectId} (${e instanceof Error ? e.message : String(e)}): ` +
        "if it does not, Semaphore runs on the template's inventory. Nothing was run.",
      { cause: e },
    );
  }
  if (inventory === null) {
    throw new Error(
      `Inventory ${inventoryId} does not exist in project ${projectId}: Semaphore would run on the template's inventory instead, without saying so. Nothing was run.`,
    );
  }
}

/**
 * La versión que despliega una plantilla deploy es la build task que se le
 * pasa. Sin ella el servidor corre igual, sin versión de entrada y sin error,
 * así que se hace lo que hace la UI (`TaskForm.vue`): la última build en
 * `success` de su plantilla build.
 */
async function resolveBuildTask(
  client: SemaphoreClient,
  projectId: number,
  template: Template | null,
  requested: number | undefined,
): Promise<number | undefined> {
  if (requested !== undefined) {
    // Medido en 2.19.12: un id inexistente da 500 (la FK), y uno de OTRO
    // proyecto pasa la FK y `Fill` lo ignora — un deploy sin versión. Y uno que
    // existe pero no es una build (una task cualquiera) también: el servidor
    // recorre la cadena (`GetIncomingVersion`), no la encuentra y corre sin versión.
    const build = await client.tasks.get(projectId, requested);
    if (build === null) {
      throw new Error(`Build task ${requested} does not exist in project ${projectId}, so there is no version to deploy. Nothing was run.`);
    }
    if (build.status !== "success") {
      throw new Error(`Build task ${requested} ended ${build.status}, not success: it is not a version to deploy. Nothing was run.`);
    }
    if (template !== null) {
      if (template.type !== "deploy") {
        throw new Error(`--build-task-id only applies to deploy templates; template ${template.id} ("${template.name}") is not one. Nothing was run.`);
      }
      if (template.build_template_id == null) {
        throw new Error(`Template ${template.id} ("${template.name}") has no build template, so smphe cannot check that task ${requested} is one of its builds. Nothing was run.`);
      }
      // Conservador: el servidor también acepta un deploy anterior (recorre la
      // cadena), pero una task cualquiera despliega sin versión y no se distingue
      // sin leer la cadena entera.
      if (build.template_id !== template.build_template_id) {
        throw new Error(
          `Task ${requested} belongs to template ${build.template_id}, not to ${template.build_template_id}, the build template of ` +
            `"${template.name}": smphe only deploys builds of that template. Nothing was run.`,
        );
      }
    }
    return requested;
  }
  if (template === null) {
    console.error("Could not read the template: if it is a deploy template, it runs WITHOUT a version. Pass --build-task-id to choose one.");
    return undefined;
  }
  if (template.type !== "deploy") return undefined;

  const where = `Template ${template.id} ("${template.name}") is a deploy template`;
  if (template.build_template_id == null) {
    throw new Error(`${where} with no build template, so there is no version to deploy. Pass --build-task-id <id>. Nothing was run.`);
  }
  let builds: Task[];
  try {
    builds = await client.templates.tasks(projectId, template.build_template_id);
  } catch (e) {
    throw new Error(
      `${where}, and listing the builds of template ${template.build_template_id} to pick a version failed ` +
        `(${e instanceof Error ? e.message : String(e)}). Pass --build-task-id <id>. Nothing was run.`,
      { cause: e },
    );
  }
  // El servidor las devuelve por id descendente: la primera en success es la última.
  const latest = (builds ?? []).find((t) => t.status === "success");
  if (latest === undefined) {
    throw new Error(
      `${where}, and its build template ${template.build_template_id} has no successful build to deploy. ` +
        "Run a build first, or pass --build-task-id <id>. Nothing was run.",
    );
  }
  console.error(`Deploying build task ${latest.id}${latest.version ? ` (version ${latest.version})` : ""}: the latest successful build.`);
  return latest.id;
}

/**
 * The server answers 201 whatever it did with `dry_run`: that is how a
 * `--dry-run` ran for real with `status: success`, indistinguishable from a
 * check. If the task it created does not carry the flag, it is not a check, so
 * it is stopped on the spot and the command fails.
 */
async function assertDryRunStored(client: SemaphoreClient, projectId: number, task: Task | undefined): Promise<void> {
  if (task == null) {
    throw new Error(
      "Semaphore answered the run without the task it created, so --dry-run cannot be verified. " +
        "Look for it with `smphe tasks list`: it may be running for real.",
    );
  }
  if (task.dry_run === true) return;
  const outcome = await stopUnverifiedRun(client, projectId, task.id);
  throw new Error(`Task ${task.id} was created WITHOUT dry_run: Semaphore dropped --dry-run, so it is not a check. ${outcome}`);
}

const FINAL: TaskStatus[] = ["success", "error", "stopped"];

/**
 * Stops a task that must not run, and says what really happened. Two server
 * traps, both measured on 2.19.12:
 *
 * - `force` on a QUEUED task marks it `stopped` but leaves it in the queue
 *   (`stopTaskRunner` only kills a `running` one): the runner picks it up and
 *   runs the playbook, and the task still reads `stopped`. So the stop is graceful.
 * - Stopping a task the pool no longer holds rewrites its status to `stopped`,
 *   hiding a run that already finished. So it is read first.
 *
 * Whether it ran is told by `start`, which a task stopped in the queue never gets.
 */
async function stopUnverifiedRun(client: SemaphoreClient, projectId: number, taskId: number, maxPolls = 30): Promise<string> {
  // Sin `start` y `stopped` no llegó a arrancar. Sin `start` pero `error` o
  // `success` sí pudo correr: entre `starting` y `running` la parada deja la
  // task en `stopping` sin matarla, y `running` ya no se escribe.
  const describe = (t: Task): string => {
    if (t.start) return `It STARTED at ${t.start} and ended ${t.status}: it ran for real, at least in part. Check \`smphe tasks output ${taskId}\`.`;
    if (t.status === "stopped") return "It was stopped before it started: nothing ran.";
    return `It ended ${t.status} with no start time, so whether it ran is unknown. Check \`smphe tasks output ${taskId}\`.`;
  };
  try {
    const current = await client.tasks.get(projectId, taskId);
    if (current !== null && FINAL.includes(current.status)) return `It had already finished. ${describe(current)}`;
    await client.tasks.stop(projectId, taskId);
    let unreadable = 0;
    for (let i = 0; i < maxPolls; i++) {
      const t = await client.tasks.get(projectId, taskId);
      if (t === null) unreadable++;
      if (t !== null && FINAL.includes(t.status)) return describe(t);
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    }
    if (unreadable === maxPolls) {
      return `It was asked to stop, but it could not be read afterwards: check it with \`smphe tasks get ${taskId}\`.`;
    }
    return (
      `It was asked to stop and is still not stopped after ${maxPolls}s (queued behind other tasks?): check it with ` +
      `\`smphe tasks get ${taskId}\`. Do not force it: a forced stop on a queued task runs it.`
    );
  } catch (e) {
    return `Stopping it FAILED (${e instanceof Error ? e.message : String(e)}): stop it by hand with \`smphe tasks stop ${taskId}\`.`;
  }
}

export async function handleTasksWait(
  projectFlag: number | undefined,
  taskId: number,
  opts: { json?: boolean } & WaitOpts,
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await waitAndReport(client, projectId, taskId, opts);
}

/**
 * Waits for a final status, prints the task and turns anything but `success`
 * into a non-zero exit (`WAIT_EXIT_CODES`). Final means what the server says:
 * `success`, `error`, `stopped` (`IsFinished()`); `rejected` never leaves that
 * status, so it ends the wait too.
 */
async function waitAndReport(
  client: SemaphoreClient,
  projectId: number,
  taskId: number,
  opts: { json?: boolean } & WaitOpts,
  justCreated = false,
): Promise<void> {
  let last: Task | undefined;
  let task: Task;
  try {
    task = await client.tasks.waitForCompletion(projectId, taskId, {
      ...(opts.timeout !== undefined && { timeout: opts.timeout * 1000 }),
      onPoll: (t) => {
        const changed = t.status !== last?.status;
        last = t;
        if (!changed) return;
        if (opts.progress === true) console.error(`[${new Date().toISOString()}] task ${taskId}: ${t.status}`);
        // Sin esto, un --wait sin --progress ni --timeout se queda colgado sin
        // decir que espera a una persona.
        else if (t.status === "waiting_confirmation") {
          console.error(`Task ${taskId} is waiting for approval: nothing happens until somebody approves or rejects it.`);
        }
      },
    });
  } catch (e) {
    const code = e instanceof SemaphoreApiError ? e.code : undefined;
    // stdout lleva la última task vista también aquí: un `| jq .status` no se
    // queda sin entrada justo en los dos finales que no son de la task.
    if ((code === "TIMEOUT" || code === "REJECTED") && last !== undefined) formatOutput(last, opts);
    if (code === "TIMEOUT") {
      throw new ExitError(
        `Timed out after ${opts.timeout}s waiting for task ${taskId} (last status: ${last?.status ?? "unknown"}). ` +
          `It keeps running in Semaphore; stop it with \`smphe tasks stop ${taskId}\`.`,
        WAIT_EXIT_CODES.timeout,
      );
    }
    if (code === "REJECTED") {
      throw new ExitError((e as SemaphoreApiError).statusText, WAIT_EXIT_CODES.rejected);
    }
    // Una respuesta HTTP (404, 401, 403…) se cuenta tal cual, con su pista de
    // permisos. Solo un error sin status —red, timeout por petición— es perder
    // el contacto, que corta la espera y no la task.
    // Una task que se acaba de crear no puede no existir: ese 404 sale de un
    // `get()` que no pudo leerla (2.19 contesta con el mismo 400 vacío un fallo
    // de BD), y decir "not found" invitaba a relanzarla.
    const unreadableNewTask = justCreated && last === undefined && e instanceof SemaphoreApiError && e.status === 404;
    if (e instanceof SemaphoreApiError && e.status !== 0 && !unreadableNewTask) throw e;
    const why = unreadableNewTask ? "it could not be read" : e instanceof Error ? e.message : String(e);
    throw new Error(
      `Lost track of task ${taskId} while waiting (${why}). ` +
        `It may still be running in Semaphore: \`smphe tasks wait ${taskId}\` picks it up again.`,
      { cause: e },
    );
  }

  formatOutput(task, opts);
  if (task.status === "error") throw new ExitError(`Task ${taskId} failed (status error)`, WAIT_EXIT_CODES.error);
  if (task.status === "stopped") throw new ExitError(`Task ${taskId} was stopped`, WAIT_EXIT_CODES.stopped);
}

const TERRAFORM_APPS = ["terraform", "tofu", "terragrunt"];

type Gate = { flag: string; allowedBy: string; allowed: (p: AnsibleTemplateParams & TerraformTemplateParams, t: Template) => boolean };

/**
 * Overrides que solo lee la rama ansible del ejecutor (`getPlaybookArgs`,
 * `CanOverrideInventory`). En otra app un `allow_*` que quedó de cuando la
 * plantilla era ansible no los hace aplicar: el servidor los ignora igual.
 */
const ANSIBLE_GATED = ["--limit", "--debug", "--debug-level", "--tags", "--skip-tags", "--inventory-id"];

const isAnsible = (t: Template): boolean => (t.app || "ansible") === "ansible";

/**
 * Refuses to run a task whose overrides the server would silently drop.
 *
 * Semaphore stores every override on the task and answers 201, but the
 * executor only applies each one when the template enables it
 * (services/tasks/local_executor.go, TaskRunner.go). The failure mode is nasty
 * and silent: a playbook meant for one host runs on the whole inventory, tags
 * vanish, `--debug` produces no verbose output — with no error anywhere.
 *
 * `--environment`, `--message` and `--build-task-id` need no flag: they always apply.
 *
 * `--playbook`, `--dry-run` and `--diff` need no flag either, but only ansible
 * honours them: a bash, python or terraform template stores them, answers 201 and runs
 * its own script, for real (`Task.Playbook` is read only on the ansible path of
 * `local_executor.go`). So they are refused on any other app. The terraform
 * flags (`--plan`, `--destroy`, `--auto-approve`, `--upgrade`, `--reconfigure`)
 * are the mirror image: only terraform, tofu and terragrunt read them.
 *
 * `--destroy` is the one gate the server does not have: it destroys whatever
 * the template manages even if the template does not allow it. So the CLI
 * enforces `allow_destroy` itself.
 *
 * When the template cannot be read, every flag that changes WHAT runs is
 * refused: `--dry-run`, `--plan`, `--destroy`, `--playbook` (a bash or
 * terraform template runs its own), `--build-task-id` (its template cannot be
 * checked), and the gated overrides that narrow or redirect the run
 * (`--limit`, `--tags`, `--skip-tags`, `--inventory-id`, `--git-branch`,
 * `--arguments`). Unverified, each one can turn into its opposite — a playbook
 * for one host running on the whole inventory. What still goes through does no
 * harm if dropped: `--debug`/`--debug-level`, `--diff`, `--message`,
 * `--upgrade`/`--reconfigure` (always applied by terraform) and
 * `--auto-approve` (dropped, a terraform task waits for approval).
 *
 * Returns the template it read (`null` if it could not), which the deploy
 * default needs.
 */
async function assertOverridesAreHonoured(
  client: SemaphoreClient,
  projectId: number,
  templateId: number,
  runOpts: RunTaskOpts,
): Promise<Template | null> {
  const requested: Gate[] = [];
  if (runOpts.limit !== undefined) {
    requested.push({ flag: "--limit", allowedBy: "Allow override limit in task", allowed: (p) => p.allow_override_limit === true });
  }
  if (runOpts.arguments !== undefined) {
    requested.push({ flag: "--arguments", allowedBy: "Allow override args in task", allowed: (_p, t) => t.allow_override_args_in_task === true });
  }
  if (runOpts.debug === true) {
    const flag = runOpts.debugLevel !== undefined ? "--debug-level" : "--debug";
    requested.push({ flag, allowedBy: "Allow debug", allowed: (p) => p.allow_debug === true });
  }
  if (runOpts.tags !== undefined) {
    requested.push({ flag: "--tags", allowedBy: "Allow override tags", allowed: (p) => p.allow_override_tags === true });
  }
  if (runOpts.skipTags !== undefined) {
    requested.push({ flag: "--skip-tags", allowedBy: "Allow override skip tags", allowed: (p) => p.allow_override_skip_tags === true });
  }
  if (runOpts.inventoryId !== undefined) {
    requested.push({ flag: "--inventory-id", allowedBy: "Allow override inventory", allowed: (p) => p.allow_override_inventory === true });
  }
  if (runOpts.gitBranch !== undefined) {
    requested.push({ flag: "--git-branch", allowedBy: "Allow override branch in task", allowed: (_p, t) => t.allow_override_branch_in_task === true });
  }
  if (runOpts.autoApprove === true) {
    // Una plantilla con auto_approve ya aplica sin aprobación: el flag sobra, pero no se ignora.
    requested.push({ flag: "--auto-approve", allowedBy: "Allow auto approve", allowed: (p) => p.allow_auto_approve === true || p.auto_approve === true });
  }
  const dryRun = runOpts.dryRun === true;
  const ansibleOnly = [
    ...(dryRun ? ["--dry-run"] : []),
    ...(runOpts.playbook !== undefined ? ["--playbook"] : []),
    ...(runOpts.diff === true ? ["--diff"] : []),
  ];
  const terraformOnly = [
    ...(runOpts.plan === true ? ["--plan"] : []),
    ...(runOpts.destroy === true ? ["--destroy"] : []),
    ...(runOpts.autoApprove === true ? ["--auto-approve"] : []),
    ...(runOpts.upgrade === true ? ["--upgrade"] : []),
    ...(runOpts.reconfigure === true ? ["--reconfigure"] : []),
  ];
  // Sin poder comprobar la puerta, un override que acota o redirige la run puede
  // convertirse en su contrario: un --limit ignorado corre en todo el
  // inventario. Solo pasan los que, ignorados, no hacen daño (debug) o dejan la
  // task esperando (auto-approve). Cambio deliberado: antes --limit, --tags,
  // --git-branch y --arguments pasaban con una plantilla ilegible.
  const harmlessIfDropped = new Set(["--debug", "--debug-level", "--auto-approve"]);
  const failClosed = [
    ...(dryRun ? ["--dry-run"] : []),
    ...(runOpts.plan === true ? ["--plan"] : []),
    ...(runOpts.destroy === true ? ["--destroy"] : []),
    ...(runOpts.playbook !== undefined ? ["--playbook"] : []),
    ...(runOpts.buildTaskId !== undefined ? ["--build-task-id"] : []),
    ...requested.map((g) => g.flag).filter((f) => !harmlessIfDropped.has(f)),
  ];

  // Se lee siempre, no solo con overrides: la versión de una plantilla deploy
  // sale de ella (resolveBuildTask). try/catch, not .catch(): a client without
  // the resource throws synchronously.
  let template: Template | null = null;
  let readError: unknown;
  try {
    template = await client.templates.get(projectId, templateId);
  } catch (e) {
    readError = e;
  }
  if (template === null) {
    if (failClosed.length === 0) return null;
    const why = readError === undefined ? "it was not found" : `reading it failed: ${readError instanceof Error ? readError.message : String(readError)}`;
    throw new Error(
      `${failClosed.join(", ")} need${failClosed.length === 1 ? "s" : ""} to read template ${templateId} to know what ` +
        `it would run, and ${why}. Nothing was run. Check the template id, or retry if the failure was transient.`,
    );
  }

  // `""` es el app legacy, y el servidor lo trata como ansible (`CanOverrideInventory`).
  const app = template.app || "ansible";
  const aApp = `${/^[aeiou]/.test(app) ? "an" : "a"} ${app}`;
  if (ansibleOnly.length > 0 && app !== "ansible") {
    throw new Error(
      `Template ${templateId} ("${template.name}") is ${aApp} template: Semaphore only honours ` +
        `${ansibleOnly.join(" and ")} on ansible templates, and would run this one for real with its own script. Nothing was run.`,
    );
  }
  if (terraformOnly.length > 0 && !TERRAFORM_APPS.includes(app)) {
    throw new Error(
      `Template ${templateId} ("${template.name}") is ${aApp} template: ${terraformOnly.join(", ")} only ` +
        `${terraformOnly.length === 1 ? "applies" : "apply"} to ` +
        `terraform, tofu and terragrunt templates, and this one would run for real without them. Nothing was run.`,
    );
  }
  // No es un override que el servidor ignore: es uno que NO frena. Destruye
  // aunque la plantilla no lo permita, así que el mensaje no puede ser el de
  // "would silently ignore".
  if (runOpts.destroy === true && (template.task_params as TerraformTemplateParams | undefined)?.allow_destroy !== true) {
    throw new Error(
      `Template ${templateId} ("${template.name}") does not allow --destroy ("Allow destroy" is off). ` +
        "Semaphore would destroy anyway — it does not check that setting — so smphe refuses. Nothing was run.",
    );
  }
  if (requested.length === 0) return template;

  // Ahora sí se conoce el app: un mapa de stages en una plantilla ansible se
  // acepta, responde 201 y revienta al ejecutar con "invalid format of the
  // TaskRunner extra arguments" — el fallo silencioso que esta función existe
  // para evitar.
  validateArgumentsShape(runOpts.arguments, template.app);

  const params = (template.task_params ?? {}) as AnsibleTemplateParams & TerraformTemplateParams;
  const dropped = requested.filter((r) => !r.allowed(params, template) || (ANSIBLE_GATED.includes(r.flag) && !isAnsible(template)));
  if (dropped.length === 0) return template;

  const lines = [
    `Template ${templateId} ("${template.name}") would silently ignore ` +
      `${dropped.map((d) => d.flag).join(", ")}: Semaphore accepts the task and then runs it without them.`,
  ];
  for (const d of dropped) {
    // Los overrides de ansible no existen en otra app: no hay casilla que activar.
    if (ANSIBLE_GATED.includes(d.flag) && !isAnsible(template)) lines.push(`  ${d.flag}: only ansible templates read it.`);
    else lines.push(`  ${d.flag}: enable "${d.allowedBy}" in the template settings.`);
  }
  // task_params es una unión por `app`: el limit solo existe en la variante ansible.
  const configured = params.limit;
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

  // Se lee antes de parar, por dos trampas del servidor (medidas en 2.19.12):
  // - parar una task que el pool ya no tiene la reescribe a `stopped` aunque
  //   hubiera acabado en `success`, y se pierde la prueba de que corrió;
  // - `--force` solo mata un proceso en `running`: sobre una task en cola
  //   (`waiting`, o `stopping` tras una parada normal) la marca `stopped` pero la
  //   deja en la cola, y el runner la ejecuta igual (`stopTaskRunner`).
  // Si no se puede leer, se hace lo que se pidió, como antes.
  let current: Task | null = null;
  let readFailed = false;
  try {
    current = await client.tasks.get(projectId, taskId);
  } catch (e) {
    readFailed = true;
    if (opts.force === true) {
      console.error(`Could not read task ${taskId} (${e instanceof Error ? e.message : String(e)}): forcing the stop as asked.`);
    }
  }
  if (current !== null && FINAL.includes(current.status)) {
    reportMutation(opts, {
      message: `Task ${taskId} already finished (${current.status}): nothing to stop`,
      id: taskId,
      alreadyFinished: current.status,
    });
    return;
  }
  if (opts.force === true && current === null && !readFailed) {
    // Una task que el servidor no devuelve (inexistente, o un 400 de la BD que
    // `get()` no distingue) no se puede comprobar: se hace lo que se pidió, avisando.
    console.error(`Could not read task ${taskId}: forcing the stop as asked.`);
  }
  if (opts.force === true && current !== null && current.status !== "running") {
    console.error(`Task ${taskId} is ${current.status}, not running: --force would leave it queued and it would run anyway. Stopping it normally.`);
    await client.tasks.stop(projectId, taskId);
    reportMutation(opts, { message: `Task ${taskId} stopped`, id: taskId });
    return;
  }

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
