import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SemaphoreClient } from "../../src/client.js";
import { handleBackupExport, handleBackupRestore } from "../../src/cli/backup.js";

const MOCK_BACKUP = {
  meta: { name: "Infra" },
  templates: [{ name: "Deploy web" }],
  environments: [{ name: "web" }],
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
  assert.equal(parsed.templates?.[0]?.name, "Deploy web");
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
  assert.equal(written.meta?.name, "Infra");
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

// — H5: restaurar junto al original —

test("backup restore --name renames the project before sending it; without meta it refuses", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smc-bk-"));
  const file = path.join(dir, "b.json");
  fs.writeFileSync(file, JSON.stringify({ meta: { name: "other", alert: false }, templates: [] }));
  const sent: unknown[] = [];
  const client = { backup: { restore: async (b: unknown) => { sent.push(b); return { id: 9, name: "copy" }; } } } as unknown as SemaphoreClient;
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };
  const o = console.log;
  console.log = () => {};
  try {
    await handleBackupRestore({ file, name: "copy" }, deps);
  } finally {
    console.log = o;
  }
  assert.deepEqual((sent[0] as { meta: unknown }).meta, { name: "copy", alert: false });
  fs.writeFileSync(file, JSON.stringify({ templates: [] }));
  await assert.rejects(() => handleBackupRestore({ file, name: "copy" }, deps), /no "meta" object/);
  fs.rmSync(dir, { recursive: true });
});
