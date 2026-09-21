import * as fs from "node:fs";
import * as readline from "node:readline";
import type { CreateKeyInput, KeyType, UpdateKeyInput } from "../types.js";
import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  reportMutation,
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

/**
 * The server's type is `login_password` (`db/AccessKey.go`); the CLI has always
 * spelled the flag `login`, so both are accepted and normalized here.
 */
function normalizeKeyType(type: string): KeyType {
  return (type === "login" ? "login_password" : type) as KeyType;
}

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
    throw new Error("Key not found");
  }
  formatOutput(key, opts);
}

export async function handleKeysCreate(
  projectFlag: number | undefined,
  input: Omit<CreateKeyInput, "projectId" | "type"> & {
    /** Raw value of `--type`: `login` is normalized to the server's `login_password`. */
    type: string;
    privateKey?: string;
    privateKeyFile?: string;
    login?: string;
    password?: string;
    string?: string;
  },
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const { name, privateKey, privateKeyFile, login, password } = input;
  const type = normalizeKeyType(input.type);

  let secret: CreateKeyInput["secret"];

  if (type === "ssh") {
    if (privateKey !== undefined && privateKeyFile !== undefined) {
      throw new Error("--private-key and --private-key-file are mutually exclusive");
    }
    if (privateKey === undefined && privateKeyFile === undefined) {
      throw new Error("--type ssh requires --private-key or --private-key-file");
    }

    let resolvedKey: string;
    if (privateKeyFile !== undefined) {
      try {
        resolvedKey = fs.readFileSync(privateKeyFile, "utf8");
      } catch (err) {
        const msg = `key file not found: ${privateKeyFile}`;
        throw new Error(msg, { cause: err });
      }
    } else {
      resolvedKey = privateKey as string;
    }

    if (resolvedKey.trim() === "") {
      throw new Error("private key cannot be empty");
    }

    secret = { privateKey: resolvedKey };
  } else if (type === "login_password") {
    if (!login || !password) {
      throw new Error("--type login requires --login and --password");
    }
    secret = { login, password };
  } else if (type === "string") {
    if (!input.string) {
      throw new Error("--type string requires --string");
    }
    secret = { string: input.string };
  }

  if (input.string !== undefined && type !== "string") {
    const msg = `--string only applies to --type string, not ${type}`;
    throw new Error(msg);
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
    string?: string;
  },
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const { name, type, privateKey, privateKeyFile, login, password } = input;

  let secret: UpdateKeyInput["secret"];

  if (privateKey !== undefined || privateKeyFile !== undefined) {
    if (privateKey !== undefined && privateKeyFile !== undefined) {
      throw new Error("--private-key and --private-key-file are mutually exclusive");
    }
    let resolvedKey: string;
    if (privateKeyFile !== undefined) {
      try {
        resolvedKey = fs.readFileSync(privateKeyFile, "utf8");
      } catch {
        const msg = `key file not found: ${privateKeyFile}`;
        throw new Error(msg);
      }
    } else {
      resolvedKey = privateKey as string;
    }
    if (resolvedKey.trim() === "") {
      throw new Error("private key cannot be empty");
    }
    secret = { privateKey: resolvedKey };
  } else if (login !== undefined || password !== undefined) {
    if (!login || !password) {
      throw new Error("--login and --password must be provided together");
    }
    secret = { login, password };
  } else if (input.string !== undefined) {
    if (input.string === "") {
      throw new Error("--string cannot be empty");
    }
    secret = { string: input.string };
  }

  if (!name && !type && !secret) {
    throw new Error("No fields to update. Provide --name, --type, --private-key[-file], --login/--password or --string");
  }

  const update: UpdateKeyInput = {
    ...(name !== undefined && { name }),
    ...(type !== undefined && { type: normalizeKeyType(type) }),
    ...(secret !== undefined && { secret }),
  };

  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.keys.update(projectId, id, update);
  reportMutation(opts, { message: `Key ${id} updated`, id });
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
