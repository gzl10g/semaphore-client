import { test } from "node:test";
import assert from "node:assert/strict";
import type { SemaphoreClient } from "../../src/client.js";
import {
  handleTemplatesList,
  handleTemplatesGet,
} from "../../src/cli/templates.js";

const MOCK_TEMPLATE = {
  id: 1,
  name: "Deploy App",
  project_id: 1,
  inventory_id: 2,
  repository_id: 3,
  environment_id: 4,
  playbook: "site.yml",
  app: "ansible" as const,
  allow_override_args_in_task: false,
  type: "" as const,
};

const mockClient = {
  templates: {
    list: async () => [MOCK_TEMPLATE],
    get: async (_pid: number, id: number) => (id === 1 ? MOCK_TEMPLATE : null),
    create: async () => ({ ...MOCK_TEMPLATE, id: 2 }),
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

test("handleTemplatesList outputs table with template name", async () => {
  const cap = captureLog();
  try {
    await handleTemplatesList(1, { json: false }, DEPS);
  } finally {
    cap.restore();
  }
  const output = cap.lines.join("\n");
  assert.ok(output.includes("Deploy App"), `Expected "Deploy App" in output:\n${output}`);
});

test("handleTemplatesGet id:99 throws Error for not found", async () => {
  await assert.rejects(
    () => handleTemplatesGet(1, 99, { json: false }, DEPS),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("not found"));
      return true;
    },
  );
});
