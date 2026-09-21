import * as readline from "node:readline";
import type { CreateTemplateInput, UpdateTemplateInput } from "../types.js";
import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  reportMutation,
  validateArgumentsShape,
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
  // El servidor solo exige inventario cuando el app es ansible; pedirlo siempre
  // impedía crear una plantilla de bash, python o terraform desde la CLI.
  validateArgumentsShape(input.arguments, input.app ?? "ansible");

  const app = input.app ?? "ansible";
  if (app === "ansible" && input.inventoryId === undefined) {
    const msg = "--inventory-id is required for an ansible template";
    throw new Error(msg);
  }

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

  // El app decide qué forma de `arguments` es ejecutable, y en un update puede
  // no venir en el input: se lee de la plantilla, que además es la misma lectura
  // que el recurso hace para el merge.
  if (input.arguments !== undefined) {
    const existing = await client.templates.get(projectId, id);
    validateArgumentsShape(input.arguments, input.app ?? existing?.app);
  }

  await client.templates.update(projectId, id, input);
  reportMutation(opts, { message: `Template ${id} updated`, id });
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

export async function handleTemplatesRefs(
  projectFlag: number | undefined,
  id: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  formatOutput(await client.templates.refs(getProjectId(projectFlag, deps), id), opts);
}

export async function handleTemplatesStopAll(
  projectFlag: number | undefined,
  id: number,
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.templates.stopAllTasks(projectId, id);
  console.log(`Stopped every running task of template ${id}`);
}
