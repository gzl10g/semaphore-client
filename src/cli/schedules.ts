import * as readline from "node:readline";
import type { CreateScheduleInput, UpdateScheduleInput } from "../types.js";
import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  formatOutput,
  resolveProject,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";

const SCHEDULES_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 6 },
  { key: "name", label: "Name", width: 30 },
  { key: "cron_format", label: "Cron", width: 20 },
  { key: "template_id", label: "Template ID", width: 12 },
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

export async function handleSchedulesList(
  projectFlag: number | undefined,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const schedules = await client.schedules.list(projectId);
  formatOutput(schedules, opts, SCHEDULES_COLUMNS);
}

export async function handleSchedulesGet(
  projectFlag: number | undefined,
  id: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const schedule = await client.schedules.get(projectId, id);
  if (schedule === null) {
    console.error("Schedule not found");
    throw new Error("Schedule not found");
  }
  formatOutput(schedule, opts);
}

export async function handleSchedulesCreate(
  projectFlag: number | undefined,
  input: Omit<CreateScheduleInput, "projectId">,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const schedule = await client.schedules.create({ ...input, projectId });
  formatOutput(schedule, opts);
}

export async function handleSchedulesUpdate(
  projectFlag: number | undefined,
  id: number,
  input: UpdateScheduleInput,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const existing = await client.schedules.get(projectId, id);
  if (!existing) {
    console.error("Schedule not found");
    throw new Error("Schedule not found");
  }
  await client.schedules.update(projectId, id, {
    templateId: input.templateId ?? existing.template_id,
    cronFormat: input.cronFormat ?? existing.cron_format,
    enabled: input.enabled ?? existing.enabled,
    ...(existing.repository_id !== undefined && {
      repositoryId: input.repositoryId ?? existing.repository_id,
    }),
  });
  console.log(`Schedule ${id} updated`);
}

export async function handleSchedulesDelete(
  projectFlag: number | undefined,
  id: number,
  opts: { yes?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  if (!opts.yes) {
    const confirmed = await askConfirmation(`Delete schedule ${id}? [y/N]: `);
    if (!confirmed) {
      console.log("Cancelled");
      return;
    }
  }
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.schedules.delete(projectId, id);
  console.log(`Schedule ${id} deleted`);
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
