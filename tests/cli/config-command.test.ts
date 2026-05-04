import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig } from "../../src/cli/config.js";
import {
  handleConfigSet,
  handleConfigShow,
  handleLoginToken,
  handleUseProject,
} from "../../src/cli/config-command.js";

function uniqueTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "smphe-cmd-test-"));
}

test("handleConfigSet persiste el host y se puede releer", async () => {
  const homeDir = uniqueTmpDir();
  await handleConfigSet("host", "http://x", { homeDir });
  const config = loadConfig({ homeDir });
  assert.equal(config.host, "http://x");
});

test("handleConfigSet persiste el token", async () => {
  const homeDir = uniqueTmpDir();
  await handleConfigSet("token", "abc", { homeDir });
  const config = loadConfig({ homeDir });
  assert.equal(config.token, "abc");
});

test("handleConfigSet lanza Error con clave invalida", async () => {
  const homeDir = uniqueTmpDir();
  await assert.rejects(
    () => handleConfigSet("invalid", "x", { homeDir }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("invalid"));
      return true;
    },
  );
});

test("handleConfigShow imprime output sin revelar token completo", async () => {
  const homeDir = uniqueTmpDir();
  await handleConfigSet("host", "http://example.com", { homeDir });
  await handleConfigSet("token", "supersecrettoken1234", { homeDir });

  const lines: string[] = [];
  const originalLog = console.log;
  try {
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    await handleConfigShow({ homeDir });
  } finally {
    console.log = originalLog;
  }

  const output = lines.join("\n");
  assert.ok(output.includes("http://example.com"), "debe mostrar el host");
  assert.ok(!output.includes("supersecrettoken"), "no debe mostrar el token completo");
  assert.ok(output.includes("****"), "debe enmascarar el token con ****");
});

test("handleLoginToken guarda el token correctamente", async () => {
  const homeDir = uniqueTmpDir();
  await handleLoginToken("mytoken", { homeDir });
  const config = loadConfig({ homeDir });
  assert.equal(config.token, "mytoken");
});

test("handleUseProject guarda activeProject: 5", async () => {
  const homeDir = uniqueTmpDir();
  await handleUseProject(5, { homeDir });
  const config = loadConfig({ homeDir });
  assert.equal(config.activeProject, 5);
});

test("handleUseProject lanza Error con id 0", async () => {
  const homeDir = uniqueTmpDir();
  await assert.rejects(
    () => handleUseProject(0, { homeDir }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("0"));
      return true;
    },
  );
});
