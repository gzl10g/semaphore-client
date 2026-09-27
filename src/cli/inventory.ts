import * as fs from "node:fs";
import * as readline from "node:readline";
import type { CreateInventoryInput, UpdateInventoryInput } from "../types.js";
import { notFound } from "../resources/merge.js";
import { loadConfig, type Config } from "./config.js";
import {
  reportUpdated,
  buildClient,
  formatOutput,
  resolveProject,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";

const INVENTORY_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 6 },
  { key: "name", label: "Name", width: 30 },
  { key: "type", label: "Type", width: 15 },
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

export async function handleInventoryList(
  projectFlag: number | undefined,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const items = await client.inventory.list(projectId);
  formatOutput(items, opts, INVENTORY_COLUMNS);
}

export async function handleInventoryGet(
  projectFlag: number | undefined,
  id: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const item = await client.inventory.get(projectId, id);
  if (item === null) {
    throw new Error("Inventory not found");
  }
  formatOutput(item, opts);
}

/**
 * `--type file` guarda una RUTA, no un contenido: la del fichero de inventario
 * dentro del repositorio (`--repository-id`) o, sin él, dentro del de la
 * plantilla (medido en 2.19.12: las dos formas corren con `inv/hosts.ini`).
 * `--inventory-file` sube el contenido de un fichero local, que en ese tipo se
 * guardaría como si fuera una ruta y la task no lo encontraría: se rechaza.
 */
function assertFileTypeInput(type: string | undefined, inventoryFile: string | undefined, repositoryId: number | null | undefined): void {
  if (type === "file" && inventoryFile !== undefined) {
    throw new Error(
      "--type file stores the PATH of the inventory inside the repository (e.g. --inventory inv/hosts.ini), " +
        "not its content: --inventory-file would upload the file's content as if it were a path. Use --inventory <path>.",
    );
  }
  if (repositoryId !== undefined && repositoryId !== null && type !== "file") {
    throw new Error(`--repository-id only applies to --type file (the repository holding the inventory file); this inventory is ${type ?? "unknown"}.`);
  }
}

function readInventoryFile(inventoryFile: string): string {
  try {
    return fs.readFileSync(inventoryFile, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`inventory file not found: ${inventoryFile}`, { cause: err });
    }
    throw err;
  }
}

export async function handleInventoryCreate(
  projectFlag: number | undefined,
  input: Omit<CreateInventoryInput, "projectId" | "inventory"> & { inventory?: string; inventoryFile?: string },
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const { inventoryFile, ...rest } = input;

  if (rest.inventory !== undefined && inventoryFile !== undefined) {
    throw new Error("--inventory and --inventory-file are mutually exclusive");
  }
  assertFileTypeInput(rest.type, inventoryFile, rest.repositoryId);

  let resolvedInventory: string;
  if (inventoryFile !== undefined) {
    resolvedInventory = readInventoryFile(inventoryFile);
  } else if (rest.inventory !== undefined) {
    resolvedInventory = rest.inventory;
  } else {
    throw new Error(rest.type === "file" ? "--type file needs --inventory <path inside the repository>" : "inventory content required: use --inventory or --inventory-file");
  }

  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const item = await client.inventory.create({ ...rest, inventory: resolvedInventory, projectId });
  formatOutput(item, opts);
}

export async function handleInventoryUpdate(
  projectFlag: number | undefined,
  id: number,
  { inventoryFile, ...input }: UpdateInventoryInput & { inventoryFile?: string },
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  if (input.inventory !== undefined && inventoryFile !== undefined) {
    throw new Error("--inventory and --inventory-file are mutually exclusive");
  }
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  if (inventoryFile !== undefined || input.repositoryId !== undefined) {
    // Las dos dependen del tipo que TENDRÁ: el pedido o el guardado.
    let type: string | undefined = input.type;
    if (type === undefined) {
      const current = await client.inventory.get(projectId, id);
      if (current === null) throw notFound("Inventory", id);
      type = current.type;
    }
    assertFileTypeInput(type, inventoryFile, input.repositoryId);
  }
  if (inventoryFile !== undefined) input.inventory = readInventoryFile(inventoryFile);
  await client.inventory.update(projectId, id, input);
  await reportUpdated(opts, `Inventory ${id} updated`, id, "inventory", () => client.inventory.get(projectId, id));
}

export async function handleInventoryDelete(
  projectFlag: number | undefined,
  id: number,
  opts: { yes?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  if (!opts.yes) {
    const confirmed = await askConfirmation(`Delete inventory ${id}? [y/N]: `);
    if (!confirmed) {
      console.log("Cancelled");
      return;
    }
  }
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.inventory.delete(projectId, id);
  console.log(`Inventory ${id} deleted`);
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
