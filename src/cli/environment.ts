import * as readline from "node:readline";
import * as fs from "node:fs";
import type {
  CreateEnvironmentInput,
  EnvironmentSecret,
  EnvironmentSecretInput,
  EnvironmentSecretType,
  UpdateEnvironmentInput,
} from "../types.js";
import { loadConfig, type Config } from "./config.js";
import {
  reportUpdated,
  buildClient,
  formatOutput,
  resolveProject,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";
import { parseDotenv } from "./dotenv.js";

// Sin columna `password`: el GET la devuelve EN CLARO (medido en 2.19.12) y la
// tabla la imprimía. Además ningún código del servidor la lee.
const ENVIRONMENT_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 6 },
  { key: "name", label: "Name", width: 30 },
] as const;

const MASK = "********";

/**
 * El `password` del variable group ("Vault password") viene en claro en el GET.
 * En JSON se enmascara (la clave se queda, para no romper a quien la lee); en la
 * salida humana no se imprime. La librería lo sigue devolviendo tal cual.
 */
function maskPassword<T extends Record<string, unknown>>(item: T, human: boolean): T {
  if (!("password" in item)) return item;
  const { password, ...rest } = item;
  if (human) return rest as T;
  return { ...rest, password: typeof password === "string" && password !== "" ? MASK : password } as unknown as T;
}

/** `--password` se guarda y nadie lo usa: el vault de ansible sale de los `vaults` de la plantilla. */
function warnDeprecatedPassword(password: string | undefined): void {
  if (password === undefined) return;
  console.error(
    "Warning: --password is deprecated. Semaphore stores it but never uses it: the ansible vault password comes " +
      "from the template's vaults (smphe templates create/update --vault-key-id <login_password key>).",
  );
}

/** `KEY=VALUE` repetido → objeto, con el mismo error que `--var`. */
function parseKeyValues(entries: string[], flag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries) {
    const eqIdx = entry.indexOf("=");
    if (eqIdx === -1) {
      const msg = `${flag} must be KEY=VALUE: ${entry}`;
      throw new Error(msg);
    }
    const key = entry.slice(0, eqIdx);
    if (key === "") {
      const msg = `${flag} key cannot be empty: ${entry}`;
      throw new Error(msg);
    }
    out[key] = entry.slice(eqIdx + 1);
  }
  return out;
}

/**
 * Los cuatro cuadrantes de un variable group: variables planas (extra o de
 * entorno) y secretos (extra o de entorno). Los planos viajan en `json`/`env`;
 * los secretos, en `secrets[]` con su `type`.
 */
function buildSecrets(
  secretVars: string[] | undefined,
  secretEnvs: string[] | undefined,
): EnvironmentSecretInput[] | undefined {
  const secrets: EnvironmentSecretInput[] = [];
  for (const [name, secret] of Object.entries(parseKeyValues(secretVars ?? [], "--secret-var"))) {
    secrets.push({ type: "var", name, secret });
  }
  for (const [name, secret] of Object.entries(parseKeyValues(secretEnvs ?? [], "--secret-env"))) {
    secrets.push({ type: "env", name, secret });
  }
  return secrets.length > 0 ? secrets : undefined;
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

export async function handleEnvironmentList(
  projectFlag: number | undefined,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const items = await client.environment.list(projectId);
  formatOutput(items.map((i) => maskPassword(i, false)), opts, ENVIRONMENT_COLUMNS);
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
    throw new Error("Environment not found");
  }
  formatOutput(maskPassword(item, opts.json !== true), opts);
}

export async function handleEnvironmentCreate(
  projectFlag: number | undefined,
  input: Omit<CreateEnvironmentInput, "projectId"> & {
    vars?: string[];
    extraVars?: string[];
    secretVars?: string[];
    secretEnvs?: string[];
    fromEnv?: string;
    secret?: boolean;
  },
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const { vars, extraVars, secretVars, secretEnvs, fromEnv, secret, ...baseInput } = input;

  const merged: Record<string, string> = {};

  if (fromEnv !== undefined) {
    let content: string;
    try {
      content = fs.readFileSync(fromEnv, "utf8");
    } catch (err: unknown) {
      const msg = `env file not found: ${fromEnv}`;
      throw new Error(msg, { cause: err });
    }
    Object.assign(merged, parseDotenv(content));
  }

  if (vars !== undefined) {
    for (const entry of vars) {
      const eqIdx = entry.indexOf("=");
      if (eqIdx === -1) {
        const msg = `--var must be KEY=VALUE: ${entry}`;
        throw new Error(msg);
      }
      const key = entry.slice(0, eqIdx);
      if (key === "") {
        const msg = `--var key cannot be empty: ${entry}`;
        throw new Error(msg);
      }
      merged[key] = entry.slice(eqIdx + 1);
    }
  }

  const createInput: CreateEnvironmentInput = { ...baseInput, projectId: 0 };

  const extra = parseKeyValues(extraVars ?? [], "--extra-var");
  if (secret === true && Object.keys(extra).length > 0) {
    const msg = "--secret and --extra-var both write the extra variables field; use --extra-var alone";
    throw new Error(msg);
  }
  if (Object.keys(extra).length > 0) createInput.json = JSON.stringify(extra);

  const secrets = buildSecrets(secretVars, secretEnvs);
  if (secrets !== undefined) createInput.secrets = secrets;
  if (Object.keys(merged).length > 0) {
    if (secret === true) {
      createInput.json = JSON.stringify(merged);
    } else {
      createInput.env = JSON.stringify(merged);
    }
  }

  warnDeprecatedPassword(createInput.password);
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const item = await client.environment.create({ ...createInput, projectId });
  formatOutput(maskPassword(item, opts.json !== true), opts);
}

export async function handleEnvironmentUpdate(
  projectFlag: number | undefined,
  id: number,
  input: UpdateEnvironmentInput & {
    vars?: string[];
    extraVars?: string[];
    secretVars?: string[];
    secretEnvs?: string[];
    deleteSecrets?: string[];
    deleteSecretVars?: string[];
    deleteSecretEnvs?: string[];
  },
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const {
    vars, extraVars, secretVars, secretEnvs,
    deleteSecrets, deleteSecretVars, deleteSecretEnvs,
    ...baseInput
  } = input;
  const updateInput: UpdateEnvironmentInput = { ...baseInput };
  warnDeprecatedPassword(updateInput.password);

  const env = parseKeyValues(vars ?? [], "--var");
  if (Object.keys(env).length > 0) updateInput.env = JSON.stringify(env);

  const extra = parseKeyValues(extraVars ?? [], "--extra-var");
  if (Object.keys(extra).length > 0) updateInput.json = JSON.stringify(extra);

  const secrets = buildSecrets(secretVars, secretEnvs) ?? [];
  const deletions: Array<{ name: string; type?: EnvironmentSecretType }> = [
    ...(deleteSecrets ?? []).map((name) => ({ name })),
    ...(deleteSecretVars ?? []).map((name) => ({ name, type: "var" as const })),
    ...(deleteSecretEnvs ?? []).map((name) => ({ name, type: "env" as const })),
  ];

  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);

  // El id de un secreto solo lo da el GET (el servidor nunca devuelve su valor,
  // pero sí nombre, tipo e id), y hace falta para dos cosas: borrar, y para que
  // reescribir uno existente sea un `update` y no un duplicado.
  const existing = secrets.length > 0 || deletions.length > 0
    ? await client.environment.get(projectId, id)
    : null;

  if (deletions.length > 0 && existing === null) {
    const msg = `environment ${id} not found`;
    throw new Error(msg);
  }

  const known = existing?.secrets ?? [];

  for (const secret of secrets) {
    const match = known.find((s) => s.name === secret.name && s.type === secret.type);
    if (match !== undefined) {
      // Mismo nombre y mismo tipo: es una rotación, no un secreto nuevo.
      secret.id = match.id;
      secret.operation = "update";
    }
  }

  for (const { name, type } of deletions) {
    const matches = known.filter((s) => s.name === name && (type === undefined || s.type === type));
    if (matches.length === 0) {
      const where = type === undefined ? "" : ` of type ${type}`;
      const msg = known.length === 0
        ? `environment ${id} has no secrets, so there is nothing named ${name} to delete`
        : `secret not found in environment ${id}: ${name}${where}`;
      throw new Error(msg);
    }
    if (matches.length > 1) {
      const msg =
        `secret name ${name} is ambiguous in environment ${id} (${matches.map((m) => m.type).join(", ")}): ` +
        "delete it with --delete-secret-var or --delete-secret-env";
      throw new Error(msg);
    }
    const found = matches[0] as EnvironmentSecret;
    secrets.push({ id: found.id, name: found.name, type: found.type, operation: "delete" });
  }

  if (secrets.length > 0) updateInput.secrets = secrets;
  await client.environment.update(projectId, id, updateInput);
  await reportUpdated(opts, `Environment ${id} updated`, id, "environment", async () => {
    const item = await client.environment.get(projectId, id);
    return item === null ? null : maskPassword(item, false);
  });
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
