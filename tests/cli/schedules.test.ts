import { test } from "node:test";
import assert from "node:assert/strict";
import type { SemaphoreClient } from "../../src/client.js";
import { handleSchedulesList, handleSchedulesGet, handleSchedulesUpdate, handleSchedulesCreate } from "../../src/cli/schedules.js";

const MOCK_SCHEDULE = {
  id: 1,
  project_id: 1,
  template_id: 5,
  cron_format: "0 2 * * *",
};

const mockClient = {
  schedules: {
    list: async () => [MOCK_SCHEDULE],
    get: async (_pid: number, id: number) => (id === 1 ? MOCK_SCHEDULE : null),
    create: async () => ({ ...MOCK_SCHEDULE, id: 2 }),
    update: async () => {},
    delete: async () => {},
  },
} as unknown as SemaphoreClient;

const DEPS = { client: mockClient, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };

function captureLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return { lines, restore: () => { console.log = original; } };
}

test("handleSchedulesList outputs table with cron format", async () => {
  const cap = captureLog();
  try {
    await handleSchedulesList(1, { json: false }, DEPS);
  } finally {
    cap.restore();
  }
  const output = cap.lines.join("\n");
  assert.ok(output.includes("0 2 * * *"), `Expected cron format in output:\n${output}`);
});

test("handleSchedulesGet id:99 throws Error for not found", async () => {
  await assert.rejects(
    () => handleSchedulesGet(1, 99, { json: false }, DEPS),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("not found"));
      return true;
    },
  );
});

// El merge de un update parcial (template_id, cron_format y active) vive ahora en
// SchedulesResource.update y se cubre en tests/schedules.test.ts: la librería debe
// ser segura por sí misma, no solo cuando se la llama desde la CLI.
test("handleSchedulesUpdate delegates the partial update to the resource", async () => {
  const updateCalls: unknown[] = [];
  const client = {
    schedules: {
      update: async (_pid: number, _id: number, input: unknown) => {
        updateCalls.push(input);
      },
    },
  } as unknown as SemaphoreClient;
  const deps = {
    client,
    config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 },
  };

  await handleSchedulesUpdate(1, 2, { enabled: true }, { json: false }, deps);

  assert.strictEqual(updateCalls.length, 1);
  assert.deepEqual(updateCalls[0], { enabled: true });
});

// — P2/P10 —

const CONFIG_S = { version: 1 as const, host: "http://x", token: "t", activeProject: 1 };

test("schedules update refuses --cron and --run-at together", async () => {
  await assert.rejects(
    () => handleSchedulesUpdate(1, 2, { cronFormat: "0 1 * * *", runAt: "2030-01-01T00:00:00Z" }, {}, { client: mockClient, config: CONFIG_S }),
    /mutually exclusive/,
  );
});

function gateClient(template: Record<string, unknown> | null, calls: unknown[]) {
  return {
    templates: { get: async () => template },
    schedules: {
      get: async () => ({ ...MOCK_SCHEDULE, template_id: 5 }),
      create: async (i: unknown) => { calls.push(i); return MOCK_SCHEDULE; },
      update: async (...a: unknown[]) => { calls.push(a); },
    },
  } as unknown as SemaphoreClient;
}

test("a schedule --limit is refused when the template would ignore it every time it fires", async () => {
  const calls: unknown[] = [];
  const client = gateClient({ id: 5, name: "Deploy", app: "ansible", task_params: {} }, calls);
  await assert.rejects(
    () => handleSchedulesUpdate(1, 2, { taskParams: { params: { limit: ["web"] } } }, {}, { client, config: CONFIG_S }),
    /would ignore --limit every time this schedule fires[\s\S]*Allow override limit/,
  );
  await assert.rejects(
    () => handleSchedulesCreate(1, { templateId: 5, cronFormat: "0 1 * * *", taskParams: { params: { tags: ["a"] } } }, {}, { client, config: CONFIG_S }),
    /--tags/,
  );
  assert.equal(calls.length, 0);
});

test("a schedule --limit goes through with the gate on, and a non-ansible or unreadable template refuses it", async () => {
  const calls: unknown[] = [];
  const ok = gateClient({ id: 5, name: "Deploy", app: "ansible", task_params: { allow_override_limit: true } }, calls);
  const cap = captureLog();
  try {
    await handleSchedulesUpdate(1, 2, { taskParams: { params: { limit: ["web"] } } }, {}, { client: ok, config: CONFIG_S });
  } finally {
    cap.restore();
  }
  assert.equal(calls.length, 1);
  for (const t of [{ id: 5, name: "B", app: "bash", task_params: { allow_override_limit: true } }, null]) {
    await assert.rejects(() => handleSchedulesUpdate(1, 2, { taskParams: { params: { limit: ["w"] } } }, {}, { client: gateClient(t, []), config: CONFIG_S }), /Nothing was saved/);
  }
});

test("moving a schedule to a template that ignores its stored limit warns; a new key is still refused (review B#1, 2nd round)", async () => {
  const calls: unknown[] = [];
  const client = {
    templates: { get: async () => ({ id: 1, name: "probe", app: "ansible", task_params: {} }) },
    schedules: {
      get: async () => ({ ...MOCK_SCHEDULE, template_id: 2, task_params: { params: { limit: ["web"] } } }),
      update: async (...a: unknown[]) => { calls.push(a); },
    },
  } as unknown as SemaphoreClient;
  const errs: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { errs.push(a.map(String).join(" ")); };
  const cap = captureLog();
  try {
    // La UI guarda el limit de la plantilla en los params sin mirar la casilla:
    // rechazar un update que no lo pide lo dejaría sin salida.
    await handleSchedulesUpdate(1, 2, { templateId: 1 }, {}, { client, config: CONFIG_S });
    await assert.rejects(() => handleSchedulesUpdate(1, 2, { templateId: 1, taskParams: { params: { tags: ["x"] } } }, {}, { client, config: CONFIG_S }), /would ignore --tags/);
  } finally {
    cap.restore();
    console.error = orig;
  }
  assert.equal(calls.length, 1);
  assert.match(errs.join("\n"), /ignores the stored limit/);
});

test("a schedule that does not exist answers the same 404 whatever the flags (review B#4)", async () => {
  const client = { schedules: { get: async () => null } } as unknown as SemaphoreClient;
  await assert.rejects(
    () => handleSchedulesUpdate(1, 999, { taskParams: { params: { limit: ["x"] } } }, {}, { client, config: CONFIG_S }),
    (e: unknown) => (e as { status?: number }).status === 404,
  );
});
