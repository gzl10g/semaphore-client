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

// ── --limit guardrail ──

function clientForLimit(template: Record<string, unknown> | null): {
  client: SemaphoreClient;
  runs: unknown[];
} {
  const runs: unknown[] = [];
  const client = {
    templates: { get: async () => template },
    tasks: {
      run: async (_projectId: number, input: unknown) => {
        runs.push(input);
        return { id: 1, template_id: 6, project_id: 1, status: "waiting", created: "2024-01-01" };
      },
    },
  } as unknown as SemaphoreClient;
  return { client, runs };
}

const CONFIG_P1 = { version: 1 as const, host: "http://s", token: "t", activeProject: 1 };

test("--limit is refused when the template forbids overriding it", async () => {
  const { client, runs } = clientForLimit({ id: 6, name: "Update Proxmox" });
  await assert.rejects(
    () => handleTasksRun(1, 6, { limit: "pve-n2" }, {}, { client, config: CONFIG_P1 }),
    /would silently ignore --limit/,
  );
  assert.equal(runs.length, 0, "the task must not be created");
});

test("the refusal names the template's own limit when it has one", async () => {
  const { client } = clientForLimit({
    id: 6,
    name: "Deploy",
    task_params: { limit: ["devs.server.arpa"] },
  });
  await assert.rejects(
    () => handleTasksRun(1, 6, { limit: "otro" }, {}, { client, config: CONFIG_P1 }),
    /devs\.server\.arpa/,
  );
});

test("--limit goes through when the template allows the override", async () => {
  const { client, runs } = clientForLimit({
    id: 6,
    name: "Update Proxmox",
    task_params: { allow_override_limit: true },
  });
  const cap = captureLog();
  try {
    await handleTasksRun(1, 6, { limit: "pve-n2" }, { json: true }, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
  }
  assert.equal(runs.length, 1);
  assert.equal((runs[0] as { limit?: string }).limit, "pve-n2");
});

test("a run without --limit never reads the template", async () => {
  let read = false;
  const client = {
    templates: { get: async () => { read = true; return null; } },
    tasks: { run: async () => ({ id: 1, template_id: 6, project_id: 1, status: "waiting", created: "x" }) },
  } as unknown as SemaphoreClient;
  const cap = captureLog();
  try {
    await handleTasksRun(1, 6, {}, { json: true }, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
  }
  assert.equal(read, false, "the happy path must not pay an extra request");
});

test("an unreadable template does not block the run", async () => {
  const runs: unknown[] = [];
  const client = {
    templates: { get: async () => { throw new Error("boom"); } },
    tasks: {
      run: async (_p: number, input: unknown) => { runs.push(input); return { id: 1, template_id: 6, project_id: 1, status: "waiting", created: "x" }; },
    },
  } as unknown as SemaphoreClient;
  const cap = captureLog();
  try {
    await handleTasksRun(1, 6, { limit: "pve-n2" }, { json: true }, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
  }
  assert.equal(runs.length, 1);
});

test("--arguments is refused when the template forbids overriding args", async () => {
  const { client, runs } = clientForLimit({ id: 6, name: "Deploy" });
  await assert.rejects(
    () => handleTasksRun(1, 6, { arguments: '["-e","x=1"]' }, {}, { client, config: CONFIG_P1 }),
    /would silently ignore --arguments/,
  );
  assert.equal(runs.length, 0);
});

test("--debug is refused when the template does not allow debug", async () => {
  const { client, runs } = clientForLimit({ id: 6, name: "Deploy" });
  await assert.rejects(
    () => handleTasksRun(1, 6, { debug: true }, {}, { client, config: CONFIG_P1 }),
    /would silently ignore --debug/,
  );
  assert.equal(runs.length, 0);
});

test("several dropped overrides are reported together", async () => {
  const { client } = clientForLimit({ id: 6, name: "Deploy" });
  await assert.rejects(
    () => handleTasksRun(1, 6, { limit: "h1", debug: true }, {}, { client, config: CONFIG_P1 }),
    /--limit, --debug/,
  );
});

test("flags that always apply never trigger the check", async () => {
  let read = false;
  const client = {
    templates: { get: async () => { read = true; return null; } },
    tasks: { run: async () => ({ id: 1, template_id: 6, project_id: 1, status: "waiting", created: "x" }) },
  } as unknown as SemaphoreClient;
  const cap = captureLog();
  try {
    await handleTasksRun(1, 6, { playbook: "site.yml", environment: "{}", dryRun: true }, { json: true }, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
  }
  assert.equal(read, false, "--playbook/--environment/--dry-run always apply");
});

test("each override goes through once its own flag is enabled", async () => {
  const { client, runs } = clientForLimit({
    id: 6,
    name: "Deploy",
    allow_override_args_in_task: true,
    task_params: { allow_override_limit: true, allow_debug: true },
  });
  const cap = captureLog();
  try {
    await handleTasksRun(1, 6, { limit: "h1", debug: true, arguments: "[]" }, { json: true }, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
  }
  assert.equal(runs.length, 1);
});
