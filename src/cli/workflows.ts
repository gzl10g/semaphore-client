import * as readline from "node:readline";
import * as fs from "node:fs";
import type { WorkflowNodeInput, WorkflowEdgeInput } from "../types.js";
import { loadConfig, type Config } from "./config.js";
import {
  buildClient,
  formatOutput,
  resolveProject,
  type HandlerDeps,
  type TableColumn,
} from "./shared.js";

const WORKFLOWS_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 6 },
  { key: "name", label: "Name", width: 30 },
  { key: "nodes_count", label: "Nodes", width: 7 },
  { key: "edges_count", label: "Edges", width: 7 },
] as const;

const RUNS_COLUMNS: TableColumn[] = [
  { key: "id", label: "ID", width: 6 },
  { key: "status", label: "Status", width: 10 },
  { key: "root_task_id", label: "Root task", width: 10 },
  { key: "start", label: "Start", width: 20 },
] as const;

const APPROVALS_COLUMNS: TableColumn[] = [
  { key: "workflow_node_id", label: "Node ID", width: 8 },
  { key: "status", label: "Status", width: 10 },
  { key: "created", label: "Created", width: 20 },
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

export async function handleWorkflowsList(
  projectFlag: number | undefined,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const workflows = await client.workflows.list(projectId);
  if (opts.json) {
    formatOutput(workflows, opts);
    return;
  }
  // The table needs counts, which the API only exposes as nested arrays.
  const rows = workflows.map((w) => ({
    ...w,
    nodes_count: w.nodes?.length ?? 0,
    edges_count: w.edges?.length ?? 0,
  }));
  formatOutput(rows, opts, WORKFLOWS_COLUMNS);
}

export async function handleWorkflowsGet(
  projectFlag: number | undefined,
  id: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const workflow = await client.workflows.get(projectId, id);
  if (workflow === null) {
    console.error("Workflow not found");
    throw new Error("Workflow not found");
  }
  formatOutput(workflow, opts);
}

export async function handleWorkflowsDelete(
  projectFlag: number | undefined,
  id: number,
  opts: { yes?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  if (!opts.yes) {
    const confirmed = await askConfirmation(`Delete workflow ${id}? [y/N]: `);
    if (!confirmed) {
      console.log("Cancelled");
      return;
    }
  }
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.workflows.delete(projectId, id);
  console.log(`Workflow ${id} deleted`);
}

export async function handleWorkflowsRun(
  projectFlag: number | undefined,
  id: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const run = await client.workflows.run(projectId, id);
  formatOutput(run, opts);
}

export async function handleWorkflowsRuns(
  projectFlag: number | undefined,
  id: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const runs = await client.workflows.listRuns(projectId, id);
  formatOutput(runs, opts, RUNS_COLUMNS);
}

export async function handleWorkflowsStop(
  projectFlag: number | undefined,
  id: number,
  runId: number,
  _opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.workflows.stopRun(projectId, id, runId);
  console.log(`Workflow run ${runId} stopped`);
}

export async function handleWorkflowsApprovals(
  projectFlag: number | undefined,
  id: number,
  runId: number,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const approvals = await client.workflows.listApprovals(projectId, id, runId);
  formatOutput(approvals, opts, APPROVALS_COLUMNS);
}

export async function handleWorkflowsApprove(
  projectFlag: number | undefined,
  id: number,
  runId: number,
  nodeId: number,
  approved: boolean,
  _opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  await client.workflows.resolveApproval(projectId, id, runId, nodeId, approved);
  console.log(`Approval on node ${nodeId} ${approved ? "approved" : "rejected"}`);
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

export async function handleWorkflowsCreate(
  projectFlag: number | undefined,
  opts: { file: string; name?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const spec = readGraphFile(opts.file);
  const workflow = await client.workflows.create({
    projectId,
    name: opts.name ?? spec.name ?? "",
    ...(spec.description !== undefined && { description: spec.description }),
    nodes: spec.nodes,
    ...(spec.edges !== undefined && { edges: spec.edges }),
  });
  formatOutput(workflow, opts);
}

export async function handleWorkflowsUpdate(
  projectFlag: number | undefined,
  id: number,
  opts: { file?: string; name?: string; json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const projectId = getProjectId(projectFlag, deps);
  const client = resolveClient(deps);
  const spec = opts.file ? readGraphFile(opts.file) : undefined;
  await client.workflows.update(projectId, id, {
    ...(opts.name !== undefined && { name: opts.name }),
    ...(spec?.name !== undefined && opts.name === undefined && { name: spec.name }),
    ...(spec?.description !== undefined && { description: spec.description }),
    ...(spec?.nodes !== undefined && { nodes: spec.nodes }),
    ...(spec?.edges !== undefined && { edges: spec.edges }),
  });
  console.log(`Workflow ${id} updated`);
}

interface GraphFile {
  name?: string;
  description?: string;
  nodes: WorkflowNodeInput[];
  edges?: WorkflowEdgeInput[];
}

/**
 * Reads a workflow graph from JSON. Node `id`s are client-side and only used to
 * wire the edges; the server assigns the real ones. Without them the API
 * rejects any graph with edges.
 */
function readGraphFile(file: string): GraphFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (err) {
    throw new Error(`${file} is not valid JSON`, { cause: err });
  }
  const spec = parsed as GraphFile;
  if (!Array.isArray(spec.nodes) || spec.nodes.length === 0) {
    throw new Error(`${file} must contain a non-empty "nodes" array`);
  }
  const hasEdges = Array.isArray(spec.edges) && spec.edges.length > 0;
  if (hasEdges && spec.nodes.some((n) => n.id === undefined)) {
    throw new Error(
      `${file}: every node needs an "id" when the graph has edges (edges reference nodes by id)`,
    );
  }
  return spec;
}
