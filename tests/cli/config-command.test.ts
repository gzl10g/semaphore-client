import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, saveConfig } from "../../src/cli/config.js";
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
  const err = console.error;
  console.error = () => {};
  try {
    await handleLoginToken({ token: "mytoken" }, { homeDir });
  } finally {
    console.error = err;
  }
  const config = loadConfig({ homeDir });
  assert.equal(config.token, "mytoken");
});

test("--token avisa de que argv es visible para otros procesos", async () => {
  const homeDir = uniqueTmpDir();
  const warnings: string[] = [];
  const err = console.error;
  console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  try {
    await handleLoginToken({ token: "mytoken" }, { homeDir });
  } finally {
    console.error = err;
  }
  assert.match(warnings.join("\n"), /shell history/);
  assert.match(warnings.join("\n"), /--token-stdin/);
});

test("--token y --token-stdin juntos se rechazan", async () => {
  await assert.rejects(
    () => handleLoginToken({ token: "x", tokenStdin: true }, { homeDir: uniqueTmpDir() }),
    (e: unknown) => e instanceof Error && /mutually exclusive/.test(e.message),
  );
});

test("sin ninguna de las dos formas, dice cuál usar", async () => {
  await assert.rejects(
    () => handleLoginToken({}, { homeDir: uniqueTmpDir() }),
    (e: unknown) => e instanceof Error && /--token-stdin/.test(e.message),
  );
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

test("config show dice de dónde sale cada valor cuando el entorno manda", async () => {
  const homeDir = uniqueTmpDir();
  saveConfig({ version: 1, host: "https://del-fichero.example.com", token: "tokendelfichero" }, { homeDir });

  const prev = process.env["SMPHE_HOST"];
  process.env["SMPHE_HOST"] = "http://127.0.0.1:19876";
  const lines: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    await handleConfigShow({ homeDir });
  } finally {
    console.log = log;
    if (prev === undefined) delete process.env["SMPHE_HOST"]; else process.env["SMPHE_HOST"] = prev;
  }

  const output = lines.join("\n");
  assert.match(output, /127\.0\.0\.1:19876 \(from SMPHE_HOST\)/, "debe decir que el host viene del entorno");
  assert.match(output, /override .*config\.json/, "y avisar de que el entorno manda en esta shell");
  assert.match(output, /file: +.*config\.json/, "y decir qué fichero es, no una ruta inventada");
});

test("config show muestra el proyecto del entorno, no '(no configurado)' con la atribución al lado", async () => {
  const homeDir = uniqueTmpDir();
  saveConfig({ version: 1, host: "http://x", token: "t" }, { homeDir });   // sin activeProject

  const prev = process.env["SMPHE_PROJECT"];
  process.env["SMPHE_PROJECT"] = "7";
  const lines: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    await handleConfigShow({ homeDir });
  } finally {
    console.log = log;
    if (prev === undefined) delete process.env["SMPHE_PROJECT"]; else process.env["SMPHE_PROJECT"] = prev;
  }

  // Antes decía "activeProject: (no configurado) (from SMPHE_PROJECT)", que es
  // lo contrario de lo que pasa al operar: los comandos sí resuelven el entorno.
  assert.match(lines.join("\n"), /activeProject: +7 \(from SMPHE_PROJECT\)/);
});
