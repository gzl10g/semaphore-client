import * as fs from "node:fs";
import { loadConfig, type Config } from "./config.js";
import { buildClient, resolveProject, type HandlerDeps } from "./shared.js";

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

export async function handleBackupExport(
  projectFlag: number | undefined,
  opts: { file?: string },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const backup = await client.backup.export(projectId);
  const json = JSON.stringify(backup, null, 2);
  if (opts.file) {
    fs.writeFileSync(opts.file, json, { encoding: "utf-8", mode: 0o600 });
    // `mode` only applies when the file is created: re-exporting over an
    // existing file would keep its old (possibly world-readable) permissions.
    fs.chmodSync(opts.file, 0o600);
    console.log(`Project ${projectId} exported to ${opts.file}`);
    return;
  }
  console.log(json);
}

export async function handleBackupRestore(
  opts: { file: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const client = resolveClient(deps);
  const raw = fs.readFileSync(opts.file, "utf-8");
  let backup: Record<string, unknown>;
  try {
    backup = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`${opts.file} is not valid JSON`, { cause: err });
  }
  const project = await client.backup.restore(backup);
  console.log(`Project restored as "${project.name}" (id ${project.id})`);
}
