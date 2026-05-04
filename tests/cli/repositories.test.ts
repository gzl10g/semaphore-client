import { test } from "node:test";
import assert from "node:assert/strict";
import type { SemaphoreClient } from "../../src/client.js";
import { handleRepositoriesList, handleRepositoriesGet } from "../../src/cli/repositories.js";

const MOCK_REPO = {
  id: 1,
  name: "my-repo",
  project_id: 1,
  git_url: "git@github.com:org/repo.git",
  git_branch: "main",
  ssh_key_id: 5,
};

const mockClient = {
  repositories: {
    list: async () => [MOCK_REPO],
    get: async (_pid: number, id: number) => (id === 1 ? MOCK_REPO : null),
    create: async () => ({ ...MOCK_REPO, id: 2 }),
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

test("handleRepositoriesList outputs table with repo name", async () => {
  const cap = captureLog();
  try {
    await handleRepositoriesList(1, { json: false }, DEPS);
  } finally {
    cap.restore();
  }
  const output = cap.lines.join("\n");
  assert.ok(output.includes("my-repo"), `Expected "my-repo" in output:\n${output}`);
});

test("handleRepositoriesGet id:99 throws Error for not found", async () => {
  await assert.rejects(
    () => handleRepositoriesGet(1, 99, { json: false }, DEPS),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("not found"));
      return true;
    },
  );
});
