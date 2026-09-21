import { loadConfig, type Config } from "./config.js";
import * as readline from "node:readline";
import type { UpdateAppInput } from "../types.js";
import { buildClient, reportMutation, formatOutput, type HandlerDeps, type TableColumn } from "./shared.js";

const APPS_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 20 },
  { key: "active", label: "Active", width: 8 },
  { key: "priority", label: "Priority", width: 10 },
] as const;

function resolveClient(deps?: HandlerDeps) {
  if (deps?.client) return deps.client;
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  return buildClient(config);
}

/**
 * The apps a template can use. Worth listing before `templates create --app`:
 * the server answers an unknown one with `400 Invalid app id`, and the set is
 * per instance (an admin can add custom ones).
 */
export async function handleAppsList(
  opts: { json?: boolean; all?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const apps = opts.all === true ? await client.apps.list() : await client.apps.listActive();
  formatOutput(apps, opts, APPS_COLUMNS);
}

// ── administración (admin global) ──

export async function handleAppsGet(
  appId: string,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const app = await client.apps.get(appId);
  if (app === null) {
    throw new Error(`App ${appId} not found`);
  }
  // The server does not echo the key back; a caller piping this to jq would
  // otherwise get an object it cannot tell apart from any other app.
  formatOutput({ ...app, id: appId }, opts);
}

export async function handleAppsSet(
  appId: string,
  input: UpdateAppInput,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const existed = (await client.apps.get(appId)) !== null;
  await client.apps.update(appId, input);
  reportMutation(opts, {
    message: existed ? `App ${appId} updated` : `App ${appId} created`,
    id: appId,
    created: !existed,
  });
}

export async function handleAppsSetActive(
  appId: string,
  active: boolean,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  await client.apps.setActive(appId, active);
  reportMutation(opts, {
    message: `App ${appId} ${active ? "enabled" : "disabled"}`,
    id: appId,
    active,
  });
}

export async function handleAppsDelete(
  appId: string,
  opts: { yes?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  // Apps are instance-wide and templates point at them by id: removing one the
  // templates still use leaves them referring to something the server no longer
  // knows. Worth a question even when the id looks obviously disposable.
  if (!opts.yes && !(await askConfirmation(`Delete app ${appId} from the whole instance? [y/N]: `))) {
    console.log("Cancelled");
    return;
  }
  const client = resolveClient(deps);
  await client.apps.delete(appId);
  console.log(`App ${appId} deleted`);
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
