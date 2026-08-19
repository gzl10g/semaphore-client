import * as fs from "node:fs";
import * as readline from "node:readline";
import type { CreateKeyInput, UpdateKeyInput } from "../types.js";
import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  formatOutput,
  resolveProject,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";

const KEYS_COLUMNS: TableColumn[] = [
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

export async function handleKeysList(
  projectFlag: number | undefined,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const keys = await client.keys.list(projectId);
  formatOutput(keys, opts, KEYS_COLUMNS);
}

export async function handleKeysGet(
  projectFlag: number | undefined,
  id: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const key = await client.keys.get(projectId, id);
  if (key === null) {
    console.error("Key not found");
    throw new Error("Key not found");
  }
  formatOutput(key, opts);
}

export async function handleKeysCreate(
  projectFlag: number | undefined,
  input: Omit<CreateKeyInput, "projectId"> & {
    privateKey?: string;
    privateKeyFile?: string;
    login?: string;
    password?: string;
  },
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const { name, type, privateKey, privateKeyFile, login, password } = input;

  let secret: CreateKeyInput["secret"];

  if (type === "ssh") {
    if (privateKey !== undefined && privateKeyFile !== undefined) {
      console.error("--private-key and --private-key-file are mutually exclusive");
      throw new Error("--private-key and --private-key-file are mutually exclusive");
    }
    if (privateKey === undefined && privateKeyFile === undefined) {
      console.error("--type ssh requires --private-key or --private-key-file");
      throw new Error("--type ssh requires --private-key or --private-key-file");
    }

    let resolvedKey: string;
    if (privateKeyFile !== undefined) {
      try {
        resolvedKey = fs.readFileSync(privateKeyFile, "utf8");
      } catch (err) {
        const msg = `key file not found: ${privateKeyFile}`;
        console.error(msg);
        throw new Error(msg, { cause: err });
      }
    } else {
      resolvedKey = privateKey as string;
    }

    if (resolvedKey.trim() === "") {
      console.error("private key cannot be empty");
      throw new Error("private key cannot be empty");
    }

    secret = { privateKey: resolvedKey };
  } else if (type === "login") {
    if (!login || !password) {
      console.error("--type login requires --login and --password");
      throw new Error("--type login requires --login and --password");
    }
    secret = { login, password };
  }

  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const key = await client.keys.create({ name, type, projectId, secret });
  formatOutput(key, opts);
}

export async function handleKeysUpdate(
  projectFlag: number | undefined,
  id: number,
  input: {
    name?: string;
    type?: string;
    privateKey?: string;
    privateKeyFile?: string;
    login?: string;
    password?: string;
  },
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const { name, type, privateKey, privateKeyFile, login, password } = input;

  let secret: UpdateKeyInput["secret"];

  if (privateKey !== undefined || privateKeyFile !== undefined) {
    if (privateKey !== undefined && privateKeyFile !== undefined) {
      console.error("--private-key and --private-key-file are mutually exclusive");
      throw new Error("--private-key and --private-key-file are mutually exclusive");
    }
    let resolvedKey: string;
    if (privateKeyFile !== undefined) {
      try {
        resolvedKey = fs.readFileSync(privateKeyFile, "utf8");
      } catch {
        const msg = `key file not found: ${privateKeyFile}`;
        console.error(msg);
        throw new Error(msg);
      }
    } else {
      resolvedKey = privateKey as string;
    }
    if (resolvedKey.trim() === "") {
      console.error("private key cannot be empty");
      throw new Error("private key cannot be empty");
    }
    secret = { privateKey: resolvedKey };
  } else if (login !== undefined || password !== undefined) {
    if (!login || !password) {
      console.error("--login and --password must be provided together");
      throw new Error("--login and --password must be provided together");
    }
    secret = { login, password };
  }

  if (!name && !type && !secret) {
    console.error("No fields to update. Provide --name, --type, --private-key[-file], or --login/--password");
    throw new Error("No fields to update");
  }

  const update: UpdateKeyInput = {
    ...(name !== undefined && { name }),
    ...(type !== undefined && { type: type as UpdateKeyInput["type"] }),
    ...(secret !== undefined && { secret }),
  };

  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.keys.update(projectId, id, update);
  console.log(`Key ${id} updated`);
}

export async function handleKeysDelete(
  projectFlag: number | undefined,
  id: number,
  opts: { yes?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  if (!opts.yes) {
    const confirmed = await askConfirmation(`Delete key ${id}? [y/N]: `);
    if (!confirmed) {
      console.log("Cancelled");
      return;
    }
  }
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.keys.delete(projectId, id);
  console.log(`Key ${id} deleted`);
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

export type { UpdateKeyInput };
