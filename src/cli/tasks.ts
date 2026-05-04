import * as readline from "node:readline";
import type { RunTaskInput } from "../types.js";
import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  formatOutput,
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
  const tasks = await client.tasks.list(projectId, { status: opts.status as import("../types.js").TaskStatus | undefined });
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
    console.error("Task not found");
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
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
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

export async function handleTasksStop(
  projectFlag: number | undefined,
  taskId: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.tasks.stop(projectId, taskId);
  console.log(`Task ${taskId} stopped`);
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
