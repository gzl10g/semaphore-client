import { test } from "node:test";
import assert from "node:assert/strict";
import type { SemaphoreClient } from "../../src/client.js";
import { handleWhoami } from "../../src/cli/whoami.js";

function mockClient(opts: { admin?: boolean; role?: string; permissions?: number }): SemaphoreClient {
  return {
    users: {
      me: async () => ({
        id: 5,
        username: "ci",
        name: "CI (servicio)",
        admin: opts.admin ?? false,
        can_create_project: false,
      }),
    },
    projects: {
      getRole: async () => ({ role: opts.role ?? "task_runner", permissions: opts.permissions ?? 1 }),
    },
  } as unknown as SemaphoreClient;
}

function captureLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return { lines, restore: () => { console.log = original; } };
}

const CONFIG = { version: 1 as const, host: "http://semaphore.test", token: "t", activeProject: 1 };

test("json output reports role, permissions and what is denied", async () => {
  const cap = captureLog();
  try {
    await handleWhoami(undefined, { json: true }, { client: mockClient({}), config: CONFIG });
  } finally {
    cap.restore();
  }
  const parsed = JSON.parse(cap.lines.join("\n")) as Record<string, unknown>;
  assert.equal(parsed["username"], "ci");
  assert.equal(parsed["role"], "task_runner");
  assert.deepEqual(parsed["permissions"], ["run_tasks"]);
  assert.equal((parsed["can"] as string[]).length, 1);
  assert.equal((parsed["cannot"] as string[]).length, 3);
});

test("a global admin is not limited by the project role", async () => {
  const cap = captureLog();
  try {
    await handleWhoami(undefined, { json: true }, { client: mockClient({ admin: true }), config: CONFIG });
  } finally {
    cap.restore();
  }
  const parsed = JSON.parse(cap.lines.join("\n")) as Record<string, unknown>;
  assert.deepEqual(parsed["cannot"], []);
});

test("text output states that reads are always allowed", async () => {
  const cap = captureLog();
  try {
    await handleWhoami(undefined, {}, { client: mockClient({}), config: CONFIG });
  } finally {
    cap.restore();
  }
  const out = cap.lines.join("\n");
  assert.match(out, /role:\s+task_runner/);
  assert.match(out, /Reads are always allowed/);
});

test("without an active project it says so instead of failing", async () => {
  const cap = captureLog();
  try {
    await handleWhoami(undefined, {}, { client: mockClient({}), config: { version: 1, host: "h", token: "t" } });
  } finally {
    cap.restore();
  }
  assert.match(cap.lines.join("\n"), /none selected/);
});

test("an invalid --project fails loudly instead of reporting no project", async () => {
  await assert.rejects(
    () => handleWhoami(0, {}, { client: mockClient({}), config: CONFIG }),
    /Invalid project ID/,
  );
});

test("an admin on a server without can_create_project is not reported as unable", async () => {
  const cap = captureLog();
  try {
    await handleWhoami(undefined, { json: true }, {
      client: {
        users: { me: async () => ({ id: 1, username: "root", name: "Root", admin: true }) },
        projects: { getRole: async () => ({ role: "owner", permissions: 15 }) },
      } as unknown as SemaphoreClient,
      config: CONFIG,
    });
  } finally {
    cap.restore();
  }
  const parsed = JSON.parse(cap.lines.join("\n")) as Record<string, unknown>;
  assert.equal(parsed["can_create_project"], true);
});
