import { test } from "node:test";
import assert from "node:assert/strict";
import type { SemaphoreClient } from "../../src/client.js";
import {
  handleProjectsList,
  handleProjectsGet,
  handleProjectsCreate,
  handleProjectsDelete,
} from "../../src/cli/projects.js";

const MOCK_PROJECT = { id: 1, name: "Test", created: "2024-01-01", alert: false, max_parallel_tasks: 0 };

const mockClient = {
  projects: {
    list: async () => [MOCK_PROJECT],
    get: async (id: number) => (id === 1 ? MOCK_PROJECT : null),
    create: async (input: { name: string }) => ({ id: 2, name: input.name, created: "2024-01-01", alert: false, max_parallel_tasks: 0 }),
    update: async () => ({ id: 1, name: "Updated", created: "2024-01-01", alert: false, max_parallel_tasks: 0 }),
    delete: async () => {},
  },
} as unknown as SemaphoreClient;

function captureLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return {
    lines,
    restore: () => {
      console.log = original;
    },
  };
}

test("handleProjectsList json:true outputs JSON with the project", async () => {
  const cap = captureLog();
  try {
    await handleProjectsList({ json: true }, { client: mockClient });
  } finally {
    cap.restore();
  }
  const output = cap.lines.join("\n");
  const parsed = JSON.parse(output) as unknown[];
  assert.ok(Array.isArray(parsed));
  assert.equal((parsed[0] as { id: number }).id, 1);
});

test("handleProjectsList json:false outputs table with project name", async () => {
  const cap = captureLog();
  try {
    await handleProjectsList({ json: false }, { client: mockClient });
  } finally {
    cap.restore();
  }
  const output = cap.lines.join("\n");
  assert.ok(output.includes("Test"), `Expected "Test" in output:\n${output}`);
});

test("handleProjectsGet id:1 json:true returns the project", async () => {
  const cap = captureLog();
  try {
    await handleProjectsGet(1, { json: true }, { client: mockClient });
  } finally {
    cap.restore();
  }
  const output = cap.lines.join("\n");
  const parsed = JSON.parse(output) as { id: number };
  assert.equal(parsed.id, 1);
});

test("handleProjectsGet id:99 throws Error for not found", async () => {
  await assert.rejects(
    () => handleProjectsGet(99, { json: false }, { client: mockClient }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("not found"));
      return true;
    },
  );
});

test("handleProjectsCreate returns created project as JSON", async () => {
  const cap = captureLog();
  try {
    await handleProjectsCreate({ name: "New" }, { json: true }, { client: mockClient });
  } finally {
    cap.restore();
  }
  const output = cap.lines.join("\n");
  const parsed = JSON.parse(output) as { id: number; name: string };
  assert.equal(parsed.id, 2);
  assert.equal(parsed.name, "New");
});

test("handleProjectsDelete yes:true calls delete without throwing", async () => {
  let deleteCalled = false;
  const client = {
    projects: {
      ...mockClient.projects,
      delete: async () => {
        deleteCalled = true;
      },
    },
  } as unknown as SemaphoreClient;

  const cap = captureLog();
  try {
    await handleProjectsDelete(1, { yes: true }, { client });
  } finally {
    cap.restore();
  }

  assert.ok(deleteCalled, "delete should have been called");
});
