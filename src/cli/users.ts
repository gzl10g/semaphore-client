import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  formatOutput,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";

const USERS_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 6 },
  { key: "name", label: "Name", width: 25 },
  { key: "username", label: "Username", width: 20 },
  { key: "email", label: "Email", width: 30 },
  { key: "admin", label: "Admin", width: 6 },
] as const;

function resolveClient(deps?: HandlerDeps) {
  if (deps?.client) return deps.client;
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  return buildClient(config);
}

export async function handleUsersList(
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const users = await client.users.list();
  formatOutput(users, opts, USERS_COLUMNS);
}

export async function handleUsersGet(
  id: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const user = await client.users.get(id);
  if (user === null) {
    console.error("User not found");
    throw new Error("User not found");
  }
  formatOutput(user, opts);
}
