import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { SemaphoreClient } from "../src/index.js";

const CONFIG = { baseUrl: "http://semaphore.test", apiToken: "test-token" };

type FakeResponse = { status: number; body?: unknown };
type Captured = { url: string; method: string; body: Record<string, unknown> | undefined };

function mockFetch(responses: FakeResponse[], captured: Captured[] = []) {
  let i = 0;
  return mock.method(globalThis, "fetch", async (url: unknown, init: unknown) => {
    const opts = (init ?? {}) as { method?: string; body?: string };
    captured.push({
      url: String(url),
      method: opts.method ?? "GET",
      body: opts.body ? (JSON.parse(opts.body) as Record<string, unknown>) : undefined,
    });
    const r = responses[Math.min(i++, responses.length - 1)] as FakeResponse;
    const text = r.body !== undefined ? JSON.stringify(r.body) : "";
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: String(r.status),
      text: async () => text,
      json: async () => (text ? JSON.parse(text) : null),
    } as Response;
  });
}

const WORKFLOW = {
  id: 3,
  project_id: 10,
  name: "deploy-chain",
  nodes: [
    { id: 1, workflow_template_id: 3, template_id: 5, kind: "task", position_x: 0, position_y: 0 },
    { id: 2, workflow_template_id: 3, kind: "approval", approval_message: "ship?", position_x: 0, position_y: 1 },
  ],
  edges: [
    { id: 1, workflow_template_id: 3, source_node_id: 1, destination_node_id: 2, condition: "on_success" },
  ],
};

test("workflows.list() pega a /project/{id}/workflows", async () => {
  const cap: Captured[] = [];
  const fm = mockFetch([{ status: 200, body: [WORKFLOW] }], cap);
  const result = await new SemaphoreClient(CONFIG).workflows.list(10);
  assert.equal(result.length, 1);
  assert.match(cap[0]?.url ?? "", /\/api\/project\/10\/workflows$/);
  fm.mock.restore();
});

// El servidor enlaza las aristas por el id de nodo que manda el cliente. Si el
// id no viaja, la API responde "workflow edge source node does not belong to
// workflow" y no se puede crear ningún grafo de más de un nodo.
test("workflows.create() envía el id de cliente de cada nodo", async () => {
  const cap: Captured[] = [];
  const fm = mockFetch([{ status: 201, body: WORKFLOW }], cap);
  await new SemaphoreClient(CONFIG).workflows.create({
    projectId: 10,
    name: "deploy-chain",
    nodes: [
      { id: 1, kind: "task", templateId: 5 },
      { id: 2, kind: "approval", approvalMessage: "ship?" },
    ],
    edges: [{ sourceNodeId: 1, destinationNodeId: 2, condition: "on_success" }],
  });
  const nodes = cap[0]?.body?.["nodes"] as Array<Record<string, unknown>>;
  assert.equal(nodes[0]?.["id"], 1);
  assert.equal(nodes[1]?.["id"], 2);
  assert.equal(nodes[0]?.["template_id"], 5, "camelCase debe mapearse a snake_case");
  assert.equal(nodes[1]?.["approval_message"], "ship?");
  const edges = cap[0]?.body?.["edges"] as Array<Record<string, unknown>>;
  assert.equal(edges[0]?.["source_node_id"], 1);
  assert.equal(edges[0]?.["destination_node_id"], 2);
  fm.mock.restore();
});

test("workflows.create() pone position_x/y a 0 si no se indican", async () => {
  const cap: Captured[] = [];
  const fm = mockFetch([{ status: 201, body: WORKFLOW }], cap);
  await new SemaphoreClient(CONFIG).workflows.create({
    projectId: 10,
    name: "single",
    nodes: [{ id: 1, kind: "task", templateId: 5 }],
  });
  const nodes = cap[0]?.body?.["nodes"] as Array<Record<string, unknown>>;
  assert.equal(nodes[0]?.["position_x"], 0);
  assert.equal(nodes[0]?.["position_y"], 0);
  fm.mock.restore();
});

// El PUT del servidor es full-replace y rechaza un body sin nodos, así que un
// update parcial tiene que releer el workflow y reenviar lo que no cambia.
test("workflows.update() reenvía nodos y aristas actuales al cambiar solo el nombre", async () => {
  const cap: Captured[] = [];
  const fm = mockFetch(
    [
      { status: 200, body: WORKFLOW }, // GET previo
      { status: 204 }, // PUT
    ],
    cap,
  );
  await new SemaphoreClient(CONFIG).workflows.update(10, 3, { name: "otro-nombre" });
  assert.equal(cap[0]?.method, "GET");
  assert.equal(cap[1]?.method, "PUT");
  const body = cap[1]?.body as Record<string, unknown>;
  assert.equal(body["name"], "otro-nombre");
  const nodes = body["nodes"] as Array<Record<string, unknown>>;
  const edges = body["edges"] as Array<Record<string, unknown>>;
  assert.equal(nodes.length, 2, "los nodos existentes no se pueden perder");
  assert.equal(edges.length, 1, "las aristas existentes no se pueden perder");
  assert.equal(nodes[0]?.["id"], 1, "hay que conservar los ids o las aristas quedan huérfanas");
  assert.equal(nodes[1]?.["approval_message"], "ship?");
  fm.mock.restore();
});

test("workflows.update() falla si el workflow no existe", async () => {
  const fm = mockFetch([{ status: 404 }]);
  await assert.rejects(
    () => new SemaphoreClient(CONFIG).workflows.update(10, 999, { name: "x" }),
    /not found/i,
  );
  fm.mock.restore();
});

test("workflows.get() devuelve null en 404 en vez de lanzar", async () => {
  const fm = mockFetch([{ status: 404 }]);
  const result = await new SemaphoreClient(CONFIG).workflows.get(10, 999);
  assert.equal(result, null);
  fm.mock.restore();
});

test("workflows.run() hace POST a /run y devuelve el run", async () => {
  const cap: Captured[] = [];
  const fm = mockFetch(
    [{ status: 201, body: { id: 7, project_id: 10, workflow_template_id: 3, status: "running", root_task_id: 99 } }],
    cap,
  );
  const run = await new SemaphoreClient(CONFIG).workflows.run(10, 3);
  assert.equal(cap[0]?.method, "POST");
  assert.match(cap[0]?.url ?? "", /\/project\/10\/workflows\/3\/run$/);
  assert.equal(run.root_task_id, 99);
  fm.mock.restore();
});

test("workflows.resolveApproval() manda approved o rejected según el flag", async () => {
  const cap: Captured[] = [];
  const fm = mockFetch([{ status: 204 }], cap);
  const client = new SemaphoreClient(CONFIG);
  await client.workflows.resolveApproval(10, 3, 7, 2, true);
  await client.workflows.resolveApproval(10, 3, 7, 2, false);
  assert.match(cap[0]?.url ?? "", /\/runs\/7\/approvals\/2$/);
  assert.equal(cap[0]?.body?.["status"], "approved");
  assert.equal(cap[1]?.body?.["status"], "rejected");
  fm.mock.restore();
});

test("workflows.stopRun() hace POST a /stop", async () => {
  const cap: Captured[] = [];
  const fm = mockFetch([{ status: 204 }], cap);
  await new SemaphoreClient(CONFIG).workflows.stopRun(10, 3, 7);
  assert.equal(cap[0]?.method, "POST");
  assert.match(cap[0]?.url ?? "", /\/runs\/7\/stop$/);
  fm.mock.restore();
});
