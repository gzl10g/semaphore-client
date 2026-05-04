import * as fs from "node:fs";
import * as readline from "node:readline";
import type { CreateInventoryInput, UpdateInventoryInput } from "../types.js";
import { loadConfig, type Config } from "./config.js";
import {
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
    console.error("Inventory not found");
    throw new Error("Inventory not found");
  }
  formatOutput(item, opts);
}

export async function handleInventoryCreate(
  projectFlag: number | undefined,
  input: Omit<CreateInventoryInput, "projectId" | "inventory"> & { inventory?: string; inventoryFile?: string },
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const { inventoryFile, ...rest } = input;

  if (rest.inventory !== undefined && inventoryFile !== undefined) {
    console.error("--inventory and --inventory-file are mutually exclusive");
    throw new Error("--inventory and --inventory-file are mutually exclusive");
  }

  let resolvedInventory: string;
  if (inventoryFile !== undefined) {
    try {
      resolvedInventory = fs.readFileSync(inventoryFile, "utf8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        console.error(`inventory file not found: ${inventoryFile}`);
        throw new Error(`inventory file not found: ${inventoryFile}`);
      }
      throw err;
    }
  } else if (rest.inventory !== undefined) {
    resolvedInventory = rest.inventory;
  } else {
    console.error("inventory content required: use --inventory or --inventory-file");
    throw new Error("inventory content required: use --inventory or --inventory-file");
  }

  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const item = await client.inventory.create({ ...rest, inventory: resolvedInventory, projectId });
  formatOutput(item, opts);
}

export async function handleInventoryUpdate(
  projectFlag: number | undefined,
  id: number,
  input: UpdateInventoryInput,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.inventory.update(projectId, id, input);
  console.log(`Inventory ${id} updated`);
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
