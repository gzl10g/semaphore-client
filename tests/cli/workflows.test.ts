import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SemaphoreClient } from "../../src/client.js";
import {
  handleWorkflowsList,
  handleWorkflowsGet,
  handleWorkflowsRun,
  handleWorkflowsRuns,
  handleWorkflowsApprove,
  handleWorkflowsStop,
  handleWorkflowsCreate,
} from "../../src/cli/workflows.js";

const MOCK_WORKFLOW = {
  id: 1,
  project_id: 1,
  name: "deploy-chain",
  nodes: [
    { id: 1, workflow_template_id: 1, template_id: 5, kind: "task", position_x: 0, position_y: 0 },
    { id: 2, workflow_template_id: 1, kind: "approval", position_x: 0, position_y: 1 },
  ],
  edges: [
    { id: 1, workflow_template_id: 1, source_node_id: 1, destination_node_id: 2, condition: "on_success" },
  ],
};

const MOCK_RUN = {
  id: 7,
  project_id: 1,
  workflow_template_id: 1,
  status: "running",
  root_task_id: 3228,
  start: "2026-08-19T12:37:51Z",
};

const calls: string[] = [];

const mockClient = {
  workflows: {
    list: async () => [MOCK_WORKFLOW],
    get: async (_pid: number, id: number) => (id === 1 ? MOCK_WORKFLOW : null),
    run: async () => MOCK_RUN,
    listRuns: async () => [MOCK_RUN],
    stopRun: async (_p: number, _w: number, runId: number) => {
      calls.push(`stop:${runId}`);
    },
    listApprovals: async () => [],
    resolveApproval: async (_p: number, _w: number, _r: number, nodeId: number, approved: boolean) => {
      calls.push(`resolve:${nodeId}:${approved}`);
    },
  },
} as unknown as SemaphoreClient;

const DEPS = {
  client: mockClient,
  config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 },
};

function captureLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return { lines, restore: () => { console.log = original; } };
}

test("handleWorkflowsList shows node and edge counts, not raw arrays", async () => {
  const cap = captureLog();
  try {
    await handleWorkflowsList(1, { json: false }, DEPS);
  } finally {
    cap.restore();
  }
  const out = cap.lines.join("\n");
  assert.match(out, /deploy-chain/);
  // 2 nodes and 1 edge must appear as counts; the objects must not be dumped
  assert.match(out, /\b2\b/);
  assert.match(out, /\b1\b/);
  assert.ok(!out.includes("on_success"), "edges must not be dumped in the table");
});

test("handleWorkflowsList --json keeps the full graph", async () => {
  const cap = captureLog();
  try {
    await handleWorkflowsList(1, { json: true }, DEPS);
  } finally {
    cap.restore();
  }
  const parsed = JSON.parse(cap.lines.join("\n")) as typeof MOCK_WORKFLOW[];
  assert.equal(parsed[0]?.edges[0]?.condition, "on_success");
});

test("handleWorkflowsGet throws when the workflow does not exist", async () => {
  await assert.rejects(
    () => handleWorkflowsGet(1, 999, { json: false }, DEPS),
    /Workflow not found/,
  );
});

test("handleWorkflowsRun surfaces root_task_id to follow the run", async () => {
  const cap = captureLog();
  try {
    await handleWorkflowsRun(1, 1, { json: true }, DEPS);
  } finally {
    cap.restore();
  }
  const parsed = JSON.parse(cap.lines.join("\n")) as typeof MOCK_RUN;
  assert.equal(parsed.root_task_id, 3228);
});

test("handleWorkflowsRuns lists runs with status", async () => {
  const cap = captureLog();
  try {
    await handleWorkflowsRuns(1, 1, { json: false }, DEPS);
  } finally {
    cap.restore();
  }
  assert.match(cap.lines.join("\n"), /running/);
});

test("handleWorkflowsStop calls stopRun with the run id", async () => {
  calls.length = 0;
  const cap = captureLog();
  try {
    await handleWorkflowsStop(1, 1, 7, {}, DEPS);
  } finally {
    cap.restore();
  }
  assert.deepEqual(calls, ["stop:7"]);
});

test("approve and reject map to the same handler with a different flag", async () => {
  calls.length = 0;
  const cap = captureLog();
  try {
    await handleWorkflowsApprove(1, 1, 7, 2, true, {}, DEPS);
    await handleWorkflowsApprove(1, 1, 7, 2, false, {}, DEPS);
  } finally {
    cap.restore();
  }
  assert.deepEqual(calls, ["resolve:2:true", "resolve:2:false"]);
  assert.match(cap.lines[0] ?? "", /approved/);
  assert.match(cap.lines[1] ?? "", /rejected/);
});

// — P9: `--file` acepta el snake_case de `get --json` —

test("workflows create --file accepts the snake_case of get --json, start_version and task_params included", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smc-wf-"));
  const file = path.join(dir, "wf.json");
  fs.writeFileSync(file, JSON.stringify({
    id: 1, name: "w", start_version: "2.0.0",
    nodes: [{ id: 3, workflow_template_id: 1, template_id: 5, kind: "task", task_params: { params: { tags: ["a"] } }, position_x: 1, position_y: 2 }],
    edges: [],
  }));
  const sent: unknown[] = [];
  // La plantilla del nodo permite tags: el nodo pasa la puerta de overrides.
  const client = {
    templates: { get: async () => ({ id: 5, name: "t", app: "ansible", task_params: { allow_override_tags: true } }) },
    workflows: { create: async (i: unknown) => { sent.push(i); return { id: 9 }; } },
  } as unknown as SemaphoreClient;
  const cap = captureLog();
  try {
    await handleWorkflowsCreate(1, { file, json: true }, { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } });
  } finally {
    cap.restore();
    fs.rmSync(dir, { recursive: true });
  }
  const input = sent[0] as { startVersion?: string; nodes: Record<string, unknown>[] };
  assert.equal(input.startVersion, "2.0.0");
  assert.deepEqual(
    [input.nodes[0]?.["templateId"], input.nodes[0]?.["taskParams"], input.nodes[0]?.["positionX"], input.nodes[0]?.["positionY"]],
    [5, { params: { tags: ["a"] } }, 1, 2],
  );
});

test("a workflow node's limit on a template that would ignore it is refused before creating", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smc-wf-"));
  const file = path.join(dir, "wf.json");
  fs.writeFileSync(file, JSON.stringify({ name: "w", nodes: [{ id: 1, kind: "task", templateId: 1, taskParams: { params: { limit: ["nohost"] } } }] }));
  const sent: unknown[] = [];
  const client = {
    templates: { get: async () => ({ id: 1, name: "probe", app: "ansible", task_params: {} }) },
    workflows: { create: async (i: unknown) => { sent.push(i); return { id: 9 }; } },
  } as unknown as SemaphoreClient;
  try {
    await assert.rejects(
      () => handleWorkflowsCreate(1, { file }, { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } }),
      /would ignore --limit every time this workflow node 1 fires/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
  assert.equal(sent.length, 0);
});
