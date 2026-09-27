import * as readline from "node:readline";
import type { SemaphoreClient } from "../client.js";
import type { CreateTemplateInput, TemplateVault, UpdateTemplateInput } from "../types.js";
import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  reportUpdated,
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

const TERRAFORM_APPS = ["terraform", "tofu", "terragrunt"];
const TERRAFORM_PARAMS: Record<string, string> = {
  allow_destroy: "--[no-]allow-destroy",
  allow_auto_approve: "--[no-]allow-auto-approve",
  auto_approve: "--[no-]auto-approve",
  override_backend: "--[no-]override-backend",
};

/**
 * Los flags de terraform van a `task_params`, que el servidor guarda sin mirar
 * el app: en una plantilla ansible se guardarían y no harían nada. Mejor
 * decirlo que dar un "updated" que no significa nada.
 */
function assertTerraformParamsFit(taskParams: Record<string, unknown> | undefined, app: string | undefined): void {
  const flags = Object.keys(taskParams ?? {}).filter((k) => k in TERRAFORM_PARAMS).map((k) => TERRAFORM_PARAMS[k]);
  if (flags.length === 0 || app === undefined || TERRAFORM_APPS.includes(app)) return;
  throw new Error(`${flags.join(", ")} only ${flags.length === 1 ? "applies" : "apply"} to terraform, tofu and terragrunt templates; this one is ${app}.`);
}

/**
 * `--vault-key-id [name=]id` → `vaults` de la plantilla, que es de donde sale la
 * contraseña de vault de ansible (`installVaultKeyFiles`): la clave tiene que ser
 * `login_password` (usa su password; con otro tipo la task falla con "access key
 * type not supported for ansible password vault"). Sin nombre se llama
 * "default", y dos sin nombre se pisarían en el mapa del ejecutor.
 */
async function buildVaults(
  client: SemaphoreClient,
  projectId: number,
  specs: string[] | undefined,
): Promise<TemplateVault[] | undefined> {
  if (specs === undefined) return undefined;
  const vaults = specs.map((spec) => {
    const eq = spec.lastIndexOf("=");
    const name = eq === -1 ? undefined : spec.slice(0, eq);
    const idText = eq === -1 ? spec : spec.slice(eq + 1);
    if (!/^\d+$/.test(idText.trim()) || name === "") {
      throw new Error(`--vault-key-id must be <id> or <name>=<id>, got "${spec}"`);
    }
    return { type: "password", vault_key_id: parseInt(idText, 10), ...(name !== undefined && { name }) };
  });
  const names = vaults.map((v) => v.name ?? "default");
  if (new Set(names).size !== names.length) {
    throw new Error("several --vault-key-id need distinct names (name=id): ansible identifies each vault by name, and unnamed ones are all \"default\"");
  }
  for (const v of vaults) {
    const key = await client.keys.get(projectId, v.vault_key_id);
    if (key === null) throw new Error(`Key ${v.vault_key_id} does not exist in project ${projectId}`);
    if (key.type !== "login_password") {
      throw new Error(`Key ${v.vault_key_id} is ${key.type}: a vault password must be a login_password key (Semaphore uses its password)`);
    }
  }
  return vaults;
}

export async function handleTemplatesCreate(
  projectFlag: number | undefined,
  input: Omit<CreateTemplateInput, "projectId"> & { vaultKeyIds?: string[] },
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  // El servidor solo exige inventario cuando el app es ansible; pedirlo siempre
  // impedía crear una plantilla de bash, python o terraform desde la CLI.
  validateArgumentsShape(input.arguments, input.app ?? "ansible");

  const app = input.app ?? "ansible";
  assertTerraformParamsFit(input.taskParams as Record<string, unknown> | undefined, app);
  if (app === "ansible" && input.inventoryId === undefined) {
    const msg = "--inventory-id is required for an ansible template";
    throw new Error(msg);
  }

  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const { vaultKeyIds, ...rest } = input;
  const vaults = await buildVaults(client, projectId, vaultKeyIds);
  const template = await client.templates.create({ ...rest, ...(vaults !== undefined && { vaults }), projectId });
  formatOutput(template, opts);
}

export async function handleTemplatesUpdate(
  projectFlag: number | undefined,
  id: number,
  { vaultKeyIds, ...input }: UpdateTemplateInput & { vaultKeyIds?: string[] },
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const vaults = await buildVaults(client, projectId, vaultKeyIds);
  if (vaults !== undefined) input.vaults = vaults;

  // El app decide qué forma de `arguments` es ejecutable, y en un update puede
  // no venir en el input: se lee de la plantilla, que además es la misma lectura
  // que el recurso hace para el merge.
  const touchesTerraform = Object.keys(input.taskParams ?? {}).some((k) => k in TERRAFORM_PARAMS);
  if (input.arguments !== undefined || touchesTerraform) {
    const existing = await client.templates.get(projectId, id);
    validateArgumentsShape(input.arguments, input.app ?? existing?.app);
    assertTerraformParamsFit(input.taskParams as Record<string, unknown> | undefined, input.app ?? existing?.app);
  }

  const { description, ...rest } = input;
  // Sin ningún campo se sigue haciendo el update (lee y reescribe igual): así
  // una plantilla inexistente da 404 en vez de un "updated" que no tocó nada.
  const fullPut = Object.values(rest).some((v) => v !== undefined) || description === undefined;
  if (fullPut) {
    await client.templates.update(projectId, id, rest);
  }
  if (description !== undefined) {
    try {
      await client.templates.setDescription(projectId, id, description);
    } catch (e) {
      if (!fullPut) throw e;
      const why = e instanceof Error ? e.message : String(e);
      throw new Error(`Template ${id}: the other fields WERE saved, but the description was NOT (${why}).`, { cause: e });
    }
  }

  // Releído para enseñar lo que quedó guardado (límite, tags, descripción): un
  // "updated" a secas no deja comprobar nada sin otra llamada.
  await reportUpdated(opts, `Template ${id} updated`, id, "template", () => client.templates.get(projectId, id));
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
