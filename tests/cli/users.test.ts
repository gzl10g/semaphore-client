import { test } from "node:test";
import assert from "node:assert/strict";
import type { SemaphoreClient } from "../../src/client.js";
import { handleUsersList, handleUsersGet } from "../../src/cli/users.js";

const MOCK_USER = {
  id: 1,
  name: "Alice",
  username: "alice",
  email: "alice@example.com",
  admin: true,
  created: "2024-01-01T00:00:00Z",
};

const mockClient = {
  users: {
    list: async () => [MOCK_USER],
    get: async (id: number) => (id === 1 ? MOCK_USER : null),
  },
} as unknown as SemaphoreClient;

const DEPS = { client: mockClient };

function captureLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return { lines, restore: () => { console.log = original; } };
}

test("handleUsersList outputs table with user data", async () => {
  const cap = captureLog();
  try {
    await handleUsersList({ json: false }, DEPS);
  } finally {
    cap.restore();
  }
  const output = cap.lines.join("\n");
  assert.ok(output.includes("Alice"), `Expected "Alice" in output:\n${output}`);
  assert.ok(output.includes("alice"), `Expected "alice" in output:\n${output}`);
});

test("handleUsersGet id:99 throws Error for not found", async () => {
  await assert.rejects(
    () => handleUsersGet(99, { json: false }, DEPS),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("not found"));
      return true;
    },
  );
});
