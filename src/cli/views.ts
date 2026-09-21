import * as readline from "node:readline";
import type { CreateViewInput, UpdateViewInput } from "../types.js";
import { loadConfig, type Config } from "./config.js";
import { buildClient,
  reportMutation, formatOutput, resolveProject, type HandlerDeps, type TableColumn } from "./shared.js";

const VIEWS_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 6 },
  { key: "title", label: "Title", width: 30 },
  { key: "position", label: "Position", width: 10 },
] as const;

function resolveClient(deps?: HandlerDeps) {
  if (deps?.client) return deps.client;
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  return buildClient(config);
}

function getProjectId(projectFlag: number | undefined, deps?: HandlerDeps): number {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  return resolveProject({ flag: projectFlag, env: process.env["SMPHE_PROJECT"], config });
}

export async function handleViewsList(
  projectFlag: number | undefined,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  formatOutput(await client.views.list(getProjectId(projectFlag, deps)), opts, VIEWS_COLUMNS);
}

export async function handleViewsGet(
  projectFlag: number | undefined,
  id: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const view = await client.views.get(getProjectId(projectFlag, deps), id);
  if (view === null) {
    throw new Error("View not found");
  }
  formatOutput(view, opts);
}

export async function handleViewsCreate(
  projectFlag: number | undefined,
  input: Omit<CreateViewInput, "projectId">,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const view = await client.views.create({ ...input, projectId: getProjectId(projectFlag, deps) });
  formatOutput(view, opts);
}

export async function handleViewsUpdate(
  projectFlag: number | undefined,
  id: number,
  input: UpdateViewInput,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  await client.views.update(getProjectId(projectFlag, deps), id, input);
  reportMutation(opts, { message: `View ${id} updated`, id });
}

export async function handleViewsDelete(
  projectFlag: number | undefined,
  id: number,
  opts: { yes?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  if (opts.yes !== true) {
    const confirmed = await askConfirmation(`Delete view ${id}? [y/N]: `);
    if (!confirmed) {
      console.log("Cancelled");
      return;
    }
  }
  const client = resolveClient(deps);
  await client.views.delete(getProjectId(projectFlag, deps), id);
  console.log(`View ${id} deleted`);
}

function askConfirmation(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}
