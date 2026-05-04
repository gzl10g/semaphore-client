import { test } from "node:test";
import assert from "node:assert/strict";
import type { SemaphoreClient } from "../../src/client.js";
import { handleSchedulesList, handleSchedulesGet } from "../../src/cli/schedules.js";

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
