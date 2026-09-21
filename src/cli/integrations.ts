import * as readline from "node:readline";
import type {
  CreateIntegrationInput,
  UpdateIntegrationInput,
  CreateIntegrationMatcherInput,
  UpdateIntegrationMatcherInput,
  CreateIntegrationExtractValueInput,
  UpdateIntegrationExtractValueInput,
} from "../types.js";
import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  reportMutation,
  formatOutput,
  resolveProject,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";

const INTEGRATIONS_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 6 },
  { key: "name", label: "Name", width: 30 },
  { key: "template_id", label: "Template ID", width: 12 },
  { key: "auth_method", label: "Auth", width: 10 },
  // Which alias reaches it depends entirely on this flag, so a listing that
  // hides it cannot answer "why is my webhook not firing?".
  { key: "searchable", label: "Searchable", width: 10 },
] as const;

const MATCHERS_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 6 },
  { key: "name", label: "Name", width: 24 },
  { key: "match_type", label: "Match", width: 8 },
  { key: "body_data_type", label: "Body type", width: 10 },
  { key: "method", label: "Method", width: 10 },
  { key: "key", label: "Key", width: 24 },
  { key: "value", label: "Value", width: 24 },
] as const;

const VALUES_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 6 },
  { key: "name", label: "Name", width: 24 },
  { key: "value_source", label: "Source", width: 8 },
  { key: "body_data_type", label: "Body type", width: 10 },
  { key: "key", label: "Key", width: 24 },
  { key: "variable", label: "Variable", width: 20 },
  { key: "variable_type", label: "Var type", width: 12 },
] as const;

const ALIASES_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 6 },
  { key: "alias", label: "Alias", width: 20 },
  { key: "url", label: "URL", width: 50 },
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

// ── integrations ──

export async function handleIntegrationsList(
  projectFlag: number | undefined,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  formatOutput(await client.integrations.list(projectId), opts, INTEGRATIONS_COLUMNS);
}

export async function handleIntegrationsGet(
  projectFlag: number | undefined,
  id: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const integration = await client.integrations.get(projectId, id);
  if (integration === null) {
    throw new Error("Integration not found");
  }
  formatOutput(integration, opts);
}

export async function handleIntegrationsCreate(
  projectFlag: number | undefined,
  input: Omit<CreateIntegrationInput, "projectId">,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  // Every method other than the open one reads the shared secret from a key;
  // without it the server would store an auth method it can never satisfy and
  // silently drop every request that arrives.
  if (
    input.authMethod !== undefined &&
    input.authMethod !== "" &&
    input.authSecretId === undefined
  ) {
    const msg = `--auth-method ${input.authMethod} needs --auth-secret-id: the secret lives in a project key`;
    throw new Error(msg);
  }
  if (
    (input.authMethod === "token" || input.authMethod === "hmac") &&
    (input.authHeader === undefined || input.authHeader === "")
  ) {
    const msg = `--auth-method ${input.authMethod} needs --auth-header: it names the header carrying the token or signature`;
    throw new Error(msg);
  }

  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const integration = await client.integrations.create({ ...input, projectId });
  formatOutput(integration, opts);
}

export async function handleIntegrationsUpdate(
  projectFlag: number | undefined,
  id: number,
  input: UpdateIntegrationInput,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.integrations.update(projectId, id, input);
  reportMutation(opts, { message: `Integration ${id} updated`, id });
}

export async function handleIntegrationsDelete(
  projectFlag: number | undefined,
  id: number,
  opts: { yes?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  if (!opts.yes && !(await askConfirmation(`Delete integration ${id}? [y/N]: `))) {
    console.log("Cancelled");
    return;
  }
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.integrations.delete(projectId, id);
  console.log(`Integration ${id} deleted`);
}

// ── matchers ──

export async function handleMatchersList(
  projectFlag: number | undefined,
  integrationId: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  formatOutput(
    await client.integrations.matchers.list(projectId, integrationId),
    opts,
    MATCHERS_COLUMNS,
  );
}

export async function handleMatchersGet(
  projectFlag: number | undefined,
  integrationId: number,
  matcherId: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const matcher = await client.integrations.matchers.get(projectId, integrationId, matcherId);
  if (matcher === null) {
    throw new Error("Matcher not found");
  }
  formatOutput(matcher, opts);
}

export async function handleMatchersCreate(
  projectFlag: number | undefined,
  integrationId: number,
  input: CreateIntegrationMatcherInput,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const matcher = await client.integrations.matchers.create(projectId, integrationId, input);
  await warnIfMatchersAreIgnored(client, projectId, integrationId);
  formatOutput(matcher, opts);
}

export async function handleMatchersUpdate(
  projectFlag: number | undefined,
  integrationId: number,
  matcherId: number,
  input: UpdateIntegrationMatcherInput,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.integrations.matchers.update(projectId, integrationId, matcherId, input);
  reportMutation(opts, { message: `Matcher ${matcherId} updated`, id: matcherId, integrationId });
}

export async function handleMatchersDelete(
  projectFlag: number | undefined,
  integrationId: number,
  matcherId: number,
  opts: { yes?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  if (!opts.yes && !(await askConfirmation(`Delete matcher ${matcherId}? [y/N]: `))) {
    console.log("Cancelled");
    return;
  }
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.integrations.matchers.delete(projectId, integrationId, matcherId);
  console.log(`Matcher ${matcherId} deleted`);
}

export async function handleMatchersRefs(
  projectFlag: number | undefined,
  integrationId: number,
  matcherId: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  formatOutput(await client.integrations.matchers.refs(projectId, integrationId, matcherId), opts);
}

// ── extract values ──

export async function handleValuesList(
  projectFlag: number | undefined,
  integrationId: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  formatOutput(
    await client.integrations.values.list(projectId, integrationId),
    opts,
    VALUES_COLUMNS,
  );
}

export async function handleValuesGet(
  projectFlag: number | undefined,
  integrationId: number,
  valueId: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const value = await client.integrations.values.get(projectId, integrationId, valueId);
  if (value === null) {
    throw new Error("Extract value not found");
  }
  formatOutput(value, opts);
}

export async function handleValuesCreate(
  projectFlag: number | undefined,
  integrationId: number,
  input: CreateIntegrationExtractValueInput,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  // The server's own validation, applied before the round trip so the message
  // names the flag instead of the Go field.
  if (input.valueSource === "header" && !input.key) {
    const msg = "--value-source header needs --key: the header to read";
    throw new Error(msg);
  }
  if (input.valueSource === "body" && (input.bodyDataType ?? "json") === "json" && !input.key) {
    const msg = "--value-source body with JSON body data needs --key: the path to read";
    throw new Error(msg);
  }

  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const value = await client.integrations.values.create(projectId, integrationId, input);
  formatOutput(value, opts);
}

export async function handleValuesUpdate(
  projectFlag: number | undefined,
  integrationId: number,
  valueId: number,
  input: UpdateIntegrationExtractValueInput,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.integrations.values.update(projectId, integrationId, valueId, input);
  reportMutation(opts, { message: `Extract value ${valueId} updated`, id: valueId, integrationId });
}

export async function handleValuesDelete(
  projectFlag: number | undefined,
  integrationId: number,
  valueId: number,
  opts: { yes?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  if (!opts.yes && !(await askConfirmation(`Delete extract value ${valueId}? [y/N]: `))) {
    console.log("Cancelled");
    return;
  }
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.integrations.values.delete(projectId, integrationId, valueId);
  console.log(`Extract value ${valueId} deleted`);
}

export async function handleValuesRefs(
  projectFlag: number | undefined,
  integrationId: number,
  valueId: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  formatOutput(await client.integrations.values.refs(projectId, integrationId, valueId), opts);
}

// ── aliases ──

export async function handleAliasesList(
  projectFlag: number | undefined,
  integrationId: number | undefined,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  formatOutput(
    await client.integrations.aliases.list(projectId, integrationId),
    opts,
    ALIASES_COLUMNS,
  );
}

export async function handleAliasesCreate(
  projectFlag: number | undefined,
  integrationId: number | undefined,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const alias = await client.integrations.aliases.create(projectId, integrationId);
  if (integrationId !== undefined) await warnIfAliasIsDead(client, projectId, integrationId);
  formatOutput(alias, opts);
}

export async function handleAliasesDelete(
  projectFlag: number | undefined,
  aliasId: number,
  integrationId: number | undefined,
  opts: { yes?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  if (!opts.yes && !(await askConfirmation(`Delete alias ${aliasId}? [y/N]: `))) {
    console.log("Cancelled");
    return;
  }
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.integrations.aliases.delete(projectId, aliasId, integrationId);
  console.log(`Alias ${aliasId} deleted`);
}

/**
 * `searchable` decides which alias reaches an integration, and the server says
 * nothing when the answer is "neither of the two you just set up": a request to
 * the own alias of a searchable integration is answered 204 with no task, and
 * the matchers of a non-searchable one are never evaluated. Both warnings are
 * written to stderr so `--json` output stays parseable.
 */
async function warnIfAliasIsDead(
  client: ReturnType<typeof resolveClient>,
  projectId: number,
  integrationId: number,
): Promise<void> {
  const integration = await readForWarning(client, projectId, integrationId);
  if (integration?.searchable === true) {
    console.error(
      `Warning: integration ${integrationId} is searchable, so this alias will never fire it. ` +
        `A searchable integration is reached only through the project alias, by its matchers. ` +
        `Clear the flag with: smphe integrations update ${integrationId} --no-searchable`,
    );
  }
}

async function warnIfMatchersAreIgnored(
  client: ReturnType<typeof resolveClient>,
  projectId: number,
  integrationId: number,
): Promise<void> {
  const integration = await readForWarning(client, projectId, integrationId);
  if (integration?.searchable === false) {
    console.error(
      `Warning: integration ${integrationId} is not searchable, so its matchers are never ` +
        `evaluated — its own alias fires it unconditionally. Matchers only apply to requests ` +
        `arriving through the project alias, which needs: smphe integrations update ${integrationId} --searchable`,
    );
  }
}

/**
 * The read behind a warning, which must never fail the command.
 *
 * Both warnings run AFTER the create has already happened on the server. If
 * this GET threw — a 500, an expired token, a timeout — `runHandler` would
 * print `Error:` and exit 1 for an operation that succeeded. For an alias that
 * is the worst case in this file: the random string the server generated is the
 * whole product of the command, and the user would re-run it and end up with
 * two aliases.
 */
async function readForWarning(
  client: ReturnType<typeof resolveClient>,
  projectId: number,
  integrationId: number,
) {
  try {
    return await client.integrations.get(projectId, integrationId);
  } catch {
    return null;
  }
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
