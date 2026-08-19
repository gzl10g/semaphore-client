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
