import { test } from "node:test";
import assert from "node:assert/strict";
import type { SemaphoreClient } from "../../src/client.js";
import { handleSchedulesList, handleSchedulesGet, handleSchedulesUpdate } from "../../src/cli/schedules.js";

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

// RED: falla hasta que handleSchedulesUpdate haga GET → merge → PUT
test("handleSchedulesUpdate preserves template_id when not passed (PUT reset bug)", async () => {
  const existingSchedule = { id: 2, project_id: 1, template_id: 13, cron_format: "0 * * * *", enabled: false };
  const updateCalls: unknown[] = [];

  const client = {
    schedules: {
      get: async () => existingSchedule,
      update: async (_pid: number, _id: number, input: unknown) => {
        updateCalls.push(input);
      },
    },
  } as unknown as SemaphoreClient;

  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };

  await handleSchedulesUpdate(1, 2, { enabled: true, cronFormat: "0 * * * *" }, { json: false }, deps);

  assert.strictEqual(updateCalls.length, 1);
  const sent = updateCalls[0] as Record<string, unknown>;
  // Sin el fix, templateId es undefined → template_id se pierde en la API (reset a 0)
  assert.strictEqual(sent["templateId"], 13, `template_id debería preservarse como 13, recibido: ${JSON.stringify(sent)}`);
});

// Regresión: repositoryId tiene el mismo trap en el mismo handler
test("handleSchedulesUpdate preserves repositoryId when not passed", async () => {
  const existingSchedule = { id: 3, project_id: 1, template_id: 5, cron_format: "0 1 * * *", enabled: true, repository_id: 7 };
  const updateCalls: unknown[] = [];

  const client = {
    schedules: {
      get: async () => existingSchedule,
      update: async (_pid: number, _id: number, input: unknown) => {
        updateCalls.push(input);
      },
    },
  } as unknown as SemaphoreClient;

  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };

  await handleSchedulesUpdate(1, 3, { cronFormat: "0 2 * * *" }, { json: false }, deps);

  const sent = updateCalls[0] as Record<string, unknown>;
  assert.strictEqual(sent["repositoryId"], 7, `repositoryId debería preservarse como 7, recibido: ${JSON.stringify(sent)}`);
});
