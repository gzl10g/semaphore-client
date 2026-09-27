import * as readline from "node:readline";
import type { UpdateGlobalRoleInput } from "../types.js";
import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  reportMutation,
  formatOutput,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";

const ROLES_COLUMNS: TableColumn[] = [
  { key: "slug", label: "Slug", width: 20 },
  { key: "name", label: "Name", width: 28 },
  { key: "permissions", label: "Permissions", width: 12 },
] as const;

const POOL_COLUMNS: TableColumn[] = [
  { key: "task_id", label: "Task", width: 8 },
  { key: "project_id", label: "Project", width: 8 },
  // Without it the table cannot answer the one question it is asked: is this
  // running, or is it stuck waiting for a slot?
  { key: "location", label: "Where", width: 8 },
  { key: "status", label: "Status", width: 12 },
  { key: "username", label: "User", width: 16 },
] as const;

function resolveClient(deps?: HandlerDeps) {
  if (deps?.client) return deps.client;
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  return buildClient(config);
}

// ── global roles ──

export async function handleRolesList(
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  formatOutput(await client.roles.list(), opts, ROLES_COLUMNS);
}

export async function handleRolesGet(
  slug: string,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const role = await client.roles.get(slug);
  if (role === null) {
    throw new Error(`Role ${slug} not found`);
  }
  formatOutput(role, opts);
}

export async function handleRolesCreate(
  slug: string,
  name: string,
  permissions: number | undefined,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  formatOutput(await client.roles.create({ slug, name, permissions }), opts);
}

export async function handleRolesUpdate(
  slug: string,
  input: UpdateGlobalRoleInput,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  await client.roles.update(slug, input);
  reportMutation(opts, { message: `Role ${slug} updated`, slug });
}

export async function handleRolesDelete(
  slug: string,
  opts: { yes?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  if (!opts.yes && !(await askConfirmation(`Delete role ${slug}? [y/N]: `))) {
    console.log("Cancelled");
    return;
  }
  const client = resolveClient(deps);
  await client.roles.delete(slug);
  console.log(`Role ${slug} deleted`);
}

// ── instance task pool ──

export async function handleInstanceTasksList(
  opts: { json?: boolean; queued?: boolean; running?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  // Encadenar los dos filtros deja la lista vacía y devuelve 0: una respuesta
  // que parece "no hay nada corriendo" cuando el pool está lleno.
  if (opts.queued === true && opts.running === true) {
    throw new Error("--queued and --running are mutually exclusive: a task is in one place or the other");
  }
  const client = resolveClient(deps);
  const tasks = await client.instanceTasks.list();
  const wanted = opts.queued === true ? "queue" : opts.running === true ? "running" : undefined;
  formatOutput(
    wanted === undefined ? tasks : tasks.filter((t) => t.location === wanted),
    opts,
    POOL_COLUMNS,
  );
}

export async function handleInstanceTasksStop(
  taskId: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);

  // The endpoint answers 204 whether or not the id was in the pool, so the
  // confirmation has to look before it speaks. But this read exists only to
  // word the message: if it fails, the stop still goes out. Running it first
  // and letting it throw meant a 500 on GET /tasks cancelled the DELETE —
  // the operator asking to stop a runaway playbook got an error about
  // listing, and the task kept running.
  let wasPooled: boolean | null;
  try {
    wasPooled = (await client.instanceTasks.list()).some((t) => t.task_id === taskId);
  } catch {
    wasPooled = null;
  }

  await client.instanceTasks.stop(taskId);

  const message =
    wasPooled === null
      ? `Stop sent for task ${taskId}; could not check whether it was in the pool`
      : wasPooled
        ? `Task ${taskId} stopped`
        : `Task ${taskId} was not queued or running; the server answered 204 anyway`;

  reportMutation(opts, { message, id: taskId, stopped: wasPooled });
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
