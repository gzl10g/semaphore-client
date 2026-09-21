import * as readline from "node:readline";
import type { UpdateProjectInput } from "../types.js";
import { loadConfig, type Config } from "./config.js";
import { buildClient,
  reportMutation, formatOutput, type HandlerDeps, type TableColumn } from "./shared.js";

const PROJECTS_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 6 },
  { key: "name", label: "Name", width: 30 },
  { key: "created", label: "Created", width: 20 },
];

function resolveClient(deps?: HandlerDeps) {
  if (deps?.client) return deps.client;
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  return buildClient(config);
}

export async function handleProjectsList(
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const projects = await client.projects.list();
  formatOutput(projects, opts, PROJECTS_COLUMNS);
}

export async function handleProjectsGet(
  id: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const project = await client.projects.get(id);
  if (project === null) {
    throw new Error("Project not found");
  }
  formatOutput(project, opts);
}

export interface CreateProjectOpts {
  name: string;
  alert?: boolean;
  alertChat?: string;
  maxParallelTasks?: number;
}

export async function handleProjectsCreate(
  input: CreateProjectOpts,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const project = await client.projects.create(input);
  formatOutput(project, opts);
}

export async function handleProjectsUpdate(
  id: number,
  input: UpdateProjectInput,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  // update() devuelve void: formatear ese void imprimía literalmente "undefined"
  // (y con --json, un "undefined" que no es JSON válido).
  await client.projects.update(id, input);
  reportMutation(opts, { message: `Project ${id} updated`, id });
}

export async function handleProjectsDelete(
  id: number,
  opts: { yes?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  if (!opts.yes) {
    const confirmed = await askConfirmation(`Delete project ${id}? [y/N]: `);
    if (!confirmed) {
      console.log("Cancelled");
      return;
    }
  }

  const client = resolveClient(deps);
  await client.projects.delete(id);
  console.log(`Project ${id} deleted`);
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

export async function handleProjectsClearCache(
  id: number,
  opts: { yes?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  if (opts.yes !== true) {
    const confirmed = await askConfirmation(`Clear the cache of project ${id}? This is irreversible. [y/N]: `);
    if (!confirmed) {
      console.log("Cancelled");
      return;
    }
  }
  const client = resolveClient(deps);
  await client.projects.clearCache(id);
  console.log(`Cache of project ${id} cleared`);
}

export async function handleProjectsTestAlerts(
  id: number,
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  await client.projects.testNotifications(id);
  console.log(`Test alert sent for project ${id}`);
}
