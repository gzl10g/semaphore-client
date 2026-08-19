import * as readline from "node:readline";
import * as fs from "node:fs";
import type { CreateEnvironmentInput, UpdateEnvironmentInput } from "../types.js";
import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  formatOutput,
  resolveProject,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";
import { parseDotenv } from "./dotenv.js";

const ENVIRONMENT_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 6 },
  { key: "name", label: "Name", width: 30 },
  { key: "password", label: "Password", width: 20 },
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

export async function handleEnvironmentList(
  projectFlag: number | undefined,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const items = await client.environment.list(projectId);
  formatOutput(items, opts, ENVIRONMENT_COLUMNS);
}

export async function handleEnvironmentGet(
  projectFlag: number | undefined,
  id: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const item = await client.environment.get(projectId, id);
  if (item === null) {
    console.error("Environment not found");
    throw new Error("Environment not found");
  }
  formatOutput(item, opts);
}

export async function handleEnvironmentCreate(
  projectFlag: number | undefined,
  input: Omit<CreateEnvironmentInput, "projectId"> & {
    vars?: string[];
    fromEnv?: string;
    secret?: boolean;
  },
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const { vars, fromEnv, secret, ...baseInput } = input;

  const merged: Record<string, string> = {};

  if (fromEnv !== undefined) {
    let content: string;
    try {
      content = fs.readFileSync(fromEnv, "utf8");
    } catch (err: unknown) {
      const msg = `env file not found: ${fromEnv}`;
      console.error(msg);
      throw new Error(msg, { cause: err });
    }
    Object.assign(merged, parseDotenv(content));
  }

  if (vars !== undefined) {
    for (const entry of vars) {
      const eqIdx = entry.indexOf("=");
      if (eqIdx === -1) {
        const msg = `--var must be KEY=VALUE: ${entry}`;
        console.error(msg);
        throw new Error(msg);
      }
      const key = entry.slice(0, eqIdx);
      if (key === "") {
        const msg = `--var key cannot be empty: ${entry}`;
        console.error(msg);
        throw new Error(msg);
      }
      merged[key] = entry.slice(eqIdx + 1);
    }
  }

  const createInput: CreateEnvironmentInput = { ...baseInput, projectId: 0 };
  if (Object.keys(merged).length > 0) {
    if (secret === true) {
      createInput.json = JSON.stringify(merged);
    } else {
      createInput.env = JSON.stringify(merged);
    }
  }

  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const item = await client.environment.create({ ...createInput, projectId });
  formatOutput(item, opts);
}

export async function handleEnvironmentUpdate(
  projectFlag: number | undefined,
  id: number,
  input: UpdateEnvironmentInput,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.environment.update(projectId, id, input);
  console.log(`Environment ${id} updated`);
}

export async function handleEnvironmentDelete(
  projectFlag: number | undefined,
  id: number,
  opts: { yes?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  if (!opts.yes) {
    const confirmed = await askConfirmation(`Delete environment ${id}? [y/N]: `);
    if (!confirmed) {
      console.log("Cancelled");
      return;
    }
  }
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.environment.delete(projectId, id);
  console.log(`Environment ${id} deleted`);
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
