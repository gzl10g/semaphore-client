import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SemaphoreClient } from "../../src/client.js";
import { handleBackupExport, handleBackupRestore } from "../../src/cli/backup.js";

const MOCK_BACKUP = {
  meta: { name: "Homelab" },
  templates: [{ name: "Deploy vega" }],
  environments: [{ name: "vega" }],
};

const mockClient = {
  backup: {
    export: async () => MOCK_BACKUP,
    restore: async (b: Record<string, unknown>) => ({
      id: 42,
      name: (b["meta"] as { name?: string } | undefined)?.name ?? "restored",
    }),
  },
} as unknown as SemaphoreClient;

const DEPS = {
  client: mockClient,
  config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 },
};

function captureLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return { lines, restore: () => { console.log = original; } };
}

test("handleBackupExport prints JSON to stdout when no --file is given", async () => {
  const cap = captureLog();
  try {
    await handleBackupExport(1, {}, DEPS);
  } finally {
    cap.restore();
  }
  const parsed = JSON.parse(cap.lines.join("\n")) as typeof MOCK_BACKUP;
  assert.equal(parsed.templates?.[0]?.name, "Deploy vega");
});

test("handleBackupExport writes the file with restrictive permissions", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smphe-backup-"));
  const file = path.join(dir, "backup.json");
  const cap = captureLog();
  try {
    await handleBackupExport(1, { file }, DEPS);
  } finally {
    cap.restore();
  }
  const written = JSON.parse(fs.readFileSync(file, "utf-8")) as typeof MOCK_BACKUP;
  assert.equal(written.meta?.name, "Homelab");
  // A project backup carries configuration worth protecting: never world-readable.
  const mode = fs.statSync(file).mode & 0o777;
  assert.equal(mode, 0o600, `expected 600, got ${mode.toString(8)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("handleBackupRestore rejects a file that is not valid JSON", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smphe-backup-"));
  const file = path.join(dir, "broken.json");
  fs.writeFileSync(file, "{ not json");
  await assert.rejects(() => handleBackupRestore({ file }, DEPS), /not valid JSON/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("handleBackupRestore reports the new project id", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smphe-backup-"));
  const file = path.join(dir, "backup.json");
  fs.writeFileSync(file, JSON.stringify(MOCK_BACKUP));
  const cap = captureLog();
  try {
    await handleBackupRestore({ file }, DEPS);
  } finally {
    cap.restore();
  }
  assert.match(cap.lines.join("\n"), /id 42/);
  fs.rmSync(dir, { recursive: true, force: true });
});
