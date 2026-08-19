import { test } from "node:test";
import assert from "node:assert/strict";
import type { SemaphoreClient } from "../../src/client.js";
import {
  handleTasksList,
  handleTasksGet,
  handleTasksRun,
  handleTasksOutput,
} from "../../src/cli/tasks.js";

const MOCK_TASK = {
  id: 1,
  template_id: 10,
  project_id: 1,
  status: "success" as const,
  debug: false,
  dry_run: false,
  created: "2024-01-01T00:00:00Z",
};

const MOCK_OUTPUT = [
  { task_id: 1, time: "2024-01-01T00:00:01Z", output: "Hello" },
  { task_id: 1, time: "2024-01-01T00:00:02Z", output: "World" },
];

let runCallArgs: unknown = null;

const mockClient = {
  tasks: {
    list: async () => [MOCK_TASK],
    get: async (_pid: number, id: number) => (id === 1 ? MOCK_TASK : null),
    run: async (_pid: number, input: unknown) => {
      runCallArgs = input;
      return { ...MOCK_TASK, id: 99 };
    },
    stop: async () => {},
    output: async () => MOCK_OUTPUT,
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

test("handleTasksList outputs table with task data", async () => {
  const cap = captureLog();
  try {
    await handleTasksList(1, { json: false }, DEPS);
  } finally {
    cap.restore();
  }
  const output = cap.lines.join("\n");
  assert.ok(output.includes("success"), `Expected "success" in output:\n${output}`);
});

test("handleTasksList json:true outputs JSON array", async () => {
  const cap = captureLog();
  try {
    await handleTasksList(1, { json: true }, DEPS);
  } finally {
    cap.restore();
  }
  const parsed = JSON.parse(cap.lines.join("\n")) as unknown[];
  assert.ok(Array.isArray(parsed));
  assert.equal((parsed[0] as { id: number }).id, 1);
});

test("handleTasksGet id:99 throws Error for not found", async () => {
  await assert.rejects(
    () => handleTasksGet(1, 99, { json: false }, DEPS),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("not found"));
      return true;
    },
  );
});

test("handleTasksRun passes arguments and playbook to client.tasks.run", async () => {
  runCallArgs = null;
  const cap = captureLog();
  try {
    await handleTasksRun(
      1,
      10,
      { arguments: '["--verbose"]', playbook: "site.yml" },
      { json: true },
      DEPS,
    );
  } finally {
    cap.restore();
  }
  assert.ok(runCallArgs !== null);
  const args = runCallArgs as { arguments?: string; playbook?: string; templateId: number };
  assert.equal(args.arguments, '["--verbose"]');
  assert.equal(args.playbook, "site.yml");
  assert.equal(args.templateId, 10);
});

test("handleTasksOutput prints lines as [time] output format", async () => {
  const cap = captureLog();
  try {
    await handleTasksOutput(1, 1, { json: false }, DEPS);
  } finally {
    cap.restore();
  }
  const output = cap.lines.join("\n");
  assert.ok(output.includes("[2024-01-01T00:00:01Z] Hello"));
  assert.ok(output.includes("[2024-01-01T00:00:02Z] World"));
});
