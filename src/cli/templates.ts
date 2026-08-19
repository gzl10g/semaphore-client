import * as readline from "node:readline";
import type { CreateTemplateInput, UpdateTemplateInput } from "../types.js";
import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  formatOutput,
  resolveProject,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";

const TEMPLATES_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 6 },
  { key: "name", label: "Name", width: 30 },
  { key: "playbook", label: "Playbook", width: 30 },
  { key: "app", label: "App", width: 12 },
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

export async function handleTemplatesList(
  projectFlag: number | undefined,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const templates = await client.templates.list(projectId);
  formatOutput(templates, opts, TEMPLATES_COLUMNS);
}

export async function handleTemplatesGet(
  projectFlag: number | undefined,
  id: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const template = await client.templates.get(projectId, id);
  if (template === null) {
    console.error("Template not found");
    throw new Error("Template not found");
  }
  formatOutput(template, opts);
}

export async function handleTemplatesCreate(
  projectFlag: number | undefined,
  input: Omit<CreateTemplateInput, "projectId">,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const template = await client.templates.create({ ...input, projectId });
  formatOutput(template, opts);
}

export async function handleTemplatesUpdate(
  projectFlag: number | undefined,
  id: number,
  input: UpdateTemplateInput,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.templates.update(projectId, id, input);
  console.log(`Template ${id} updated`);
}

export async function handleTemplatesDelete(
  projectFlag: number | undefined,
  id: number,
  opts: { yes?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  if (!opts.yes) {
    const confirmed = await askConfirmation(`Delete template ${id}? [y/N]: `);
    if (!confirmed) {
      console.log("Cancelled");
      return;
    }
  }
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.templates.delete(projectId, id);
  console.log(`Template ${id} deleted`);
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
