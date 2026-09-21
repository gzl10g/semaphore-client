import * as readline from "node:readline";
import type { CreateScheduleInput, UpdateScheduleInput } from "../types.js";
import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  reportMutation,
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
  // A schedule list that does not say what is paused is useless for the one
  // question it is asked: "is this still running?"
  { key: "enabled", label: "Enabled", width: 8 },
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
  // El servidor decide por `type`: con run_at borra el cron, y con cron borra el
  // run_at. Pedir los dos es una orden ambigua, y ninguno no es una orden.
  if (input.runAt !== undefined && input.cronFormat !== undefined) {
    const msg = "--cron and --run-at are mutually exclusive: a schedule is either recurring or one-shot";
    throw new Error(msg);
  }
  if (input.runAt === undefined && input.cronFormat === undefined) {
    const msg = "provide --cron for a recurring schedule or --run-at for a one-shot one";
    throw new Error(msg);
  }
  if (input.runAt !== undefined) input.type = "run_at";

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
  // The merge lives in the resource now, so the library is safe on its own.
  await client.schedules.update(projectId, id, input);
  reportMutation(opts, { message: `Schedule ${id} updated`, id });
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
