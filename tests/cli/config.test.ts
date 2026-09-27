import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, saveConfig, mergeConfig } from "../../src/cli/config.js";
import type { Config } from "../../src/cli/config.js";

function uniqueTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "smphe-test-"));
}

test("loadConfig returns { version: 1 } when file does not exist", () => {
  const homeDir = uniqueTmpDir();
  const result = loadConfig({ homeDir });
  assert.deepEqual(result, { version: 1 });
});

test("loadConfig parses existing JSON correctly", () => {
  const homeDir = uniqueTmpDir();
  const configDir = path.join(homeDir, ".smphe-client");
  const configFile = path.join(configDir, "config.json");
  const expected: Config = { version: 1, host: "http://example.com", token: "abc", activeProject: 5 };

  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(expected), "utf-8");

  const result = loadConfig({ homeDir });
  assert.deepEqual(result, expected);
});

test("una instalación nueva guarda en XDG (~/.config/smphe), no en un dotfile del home", () => {
  const homeDir = uniqueTmpDir();
  saveConfig({ version: 1, host: "http://test.local" }, { homeDir });

  const xdg = path.join(homeDir, ".config", "smphe", "config.json");
  const legacy = path.join(homeDir, ".smphe-client", "config.json");
  assert.ok(fs.existsSync(xdg), "debe crearse en ~/.config/smphe");
  assert.ok(!fs.existsSync(legacy), "no debe crear el dotfile viejo");
  assert.equal(loadConfig({ homeDir }).host, "http://test.local");
});

test("una config vieja en ~/.smphe-client se sigue leyendo Y escribiendo, sin moverla", () => {
  const homeDir = uniqueTmpDir();
  const legacyDir = path.join(homeDir, ".smphe-client");
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(
    path.join(legacyDir, "config.json"),
    JSON.stringify({ version: 1, host: "http://legacy.local", token: "t" }),
  );

  assert.equal(loadConfig({ homeDir }).host, "http://legacy.local");

  // Mover en silencio el fichero que guarda el token de alguien no es una
  // sorpresa aceptable en una release menor.
  saveConfig({ version: 1, host: "http://legacy.local", token: "t2" }, { homeDir });
  assert.ok(fs.existsSync(path.join(legacyDir, "config.json")));
  assert.ok(!fs.existsSync(path.join(homeDir, ".config", "smphe", "config.json")));
  assert.equal(loadConfig({ homeDir }).token, "t2");
});

test("saveConfig + loadConfig round-trip returns same object", () => {
  const homeDir = uniqueTmpDir();
  const config: Config = { version: 1, host: "http://roundtrip.test", token: "tok123", activeProject: 42 };

  saveConfig(config, { homeDir });
  const loaded = loadConfig({ homeDir });

  assert.deepEqual(loaded, config);
});

test("mergeConfig merges shallowly preserving fields not specified", () => {
  const current: Config = { version: 1, host: "http://original.com", token: "orig-token", activeProject: 1 };
  const result = mergeConfig(current, { host: "http://new.com" });

  assert.equal(result.host, "http://new.com");
  assert.equal(result.token, "orig-token");
  assert.equal(result.activeProject, 1);
  assert.equal(result.version, 1);
});

test("mergeConfig does not mutate the original object", () => {
  const current: Config = { version: 1, host: "http://original.com", token: "orig-token" };
  const result = mergeConfig(current, { host: "http://changed.com" });

  assert.equal(current.host, "http://original.com");
  assert.notEqual(result, current);
});

// — el entorno gana al fichero: sin esto, apuntar el CLI a otro servidor exige
//   editar $HOME, y quien asuma las variables de siempre habla con producción.

test("SMPHE_HOST y SMPHE_TOKEN ganan a la config del fichero", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smphe-env-"));
  fs.mkdirSync(path.join(dir, ".smphe-client"));
  fs.writeFileSync(
    path.join(dir, ".smphe-client", "config.json"),
    JSON.stringify({ version: 1, host: "https://produccion.example.com", token: "token-de-produccion" }),
  );

  const prevHost = process.env["SMPHE_HOST"];
  const prevToken = process.env["SMPHE_TOKEN"];
  process.env["SMPHE_HOST"] = "http://127.0.0.1:19876";
  process.env["SMPHE_TOKEN"] = "token-de-prueba";
  try {
    const config = loadConfig({ homeDir: dir });
    assert.equal(config.host, "http://127.0.0.1:19876");
    assert.equal(config.token, "token-de-prueba");
  } finally {
    if (prevHost === undefined) delete process.env["SMPHE_HOST"]; else process.env["SMPHE_HOST"] = prevHost;
    if (prevToken === undefined) delete process.env["SMPHE_TOKEN"]; else process.env["SMPHE_TOKEN"] = prevToken;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sin variables de entorno, la config del fichero manda", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smphe-env-"));
  fs.mkdirSync(path.join(dir, ".smphe-client"));
  fs.writeFileSync(
    path.join(dir, ".smphe-client", "config.json"),
    JSON.stringify({ version: 1, host: "https://del-fichero.example.com", token: "t" }),
  );
  const prevHost = process.env["SMPHE_HOST"];
  delete process.env["SMPHE_HOST"];
  try {
    assert.equal(loadConfig({ homeDir: dir }).host, "https://del-fichero.example.com");
  } finally {
    if (prevHost !== undefined) process.env["SMPHE_HOST"] = prevHost;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("el directorio de config queda en 700, también si ya existía abierto", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smphe-perm-"));
  const configDir = path.join(dir, ".smphe-client");
  // Simula el directorio que dejaban las versiones anteriores.
  fs.mkdirSync(configDir, { mode: 0o755, recursive: true });
  fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify({ version: 1 }));
  fs.chmodSync(configDir, 0o755);

  saveConfig({ version: 1, host: "http://x", token: "t" }, { homeDir: dir });

  assert.equal(fs.statSync(configDir).mode & 0o777, 0o700, "el directorio no debe ser legible por otros");
  assert.equal(fs.statSync(path.join(configDir, "config.json")).mode & 0o777, 0o600);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("SMPHE_TOKEN_FILE gana a SMPHE_TOKEN: un secreto no debe vivir en el entorno", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smphe-tokfile-"));
  const tokenFile = path.join(dir, "token");
  fs.writeFileSync(tokenFile, "token-del-fichero\n");

  const prevFile = process.env["SMPHE_TOKEN_FILE"];
  const prevToken = process.env["SMPHE_TOKEN"];
  process.env["SMPHE_TOKEN_FILE"] = tokenFile;
  process.env["SMPHE_TOKEN"] = "token-del-entorno";
  try {
    // El fichero manda, y el salto de línea final no forma parte del token.
    assert.equal(loadConfig({ homeDir: dir }).token, "token-del-fichero");
  } finally {
    if (prevFile === undefined) delete process.env["SMPHE_TOKEN_FILE"]; else process.env["SMPHE_TOKEN_FILE"] = prevFile;
    if (prevToken === undefined) delete process.env["SMPHE_TOKEN"]; else process.env["SMPHE_TOKEN"] = prevToken;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("XDG_CONFIG_HOME manda sobre ~/.config cuando no se pasa homeDir explícito", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smphe-xdg-"));
  // HOME también se aísla: sin esto, un saveConfig() sin `homeDir` escribe en la
  // config REAL de quien ejecuta los tests. Pasó.
  const prevXdg = process.env["XDG_CONFIG_HOME"];
  const prevHome = process.env["HOME"];
  process.env["XDG_CONFIG_HOME"] = path.join(dir, "xdg");
  process.env["HOME"] = path.join(dir, "home");
  fs.mkdirSync(process.env["HOME"], { recursive: true });
  try {
    saveConfig({ version: 1, host: "http://xdg.local" });
    assert.ok(fs.existsSync(path.join(dir, "xdg", "smphe", "config.json")));
    assert.equal(loadConfig().host, "http://xdg.local");
  } finally {
    if (prevXdg === undefined) delete process.env["XDG_CONFIG_HOME"]; else process.env["XDG_CONFIG_HOME"] = prevXdg;
    if (prevHome === undefined) delete process.env["HOME"]; else process.env["HOME"] = prevHome;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// — el fichero de token falla nombrando la variable, no con un ENOENT pelado —

test("SMPHE_TOKEN_FILE que no existe dice qué variable y qué ruta", () => {
  const prev = process.env["SMPHE_TOKEN_FILE"];
  process.env["SMPHE_TOKEN_FILE"] = "/no/existe/token";
  try {
    assert.throws(
      () => loadConfig({ homeDir: uniqueTmpDir() }),
      (e: unknown) => e instanceof Error && /SMPHE_TOKEN_FILE=\/no\/existe\/token/.test(e.message),
    );
  } finally {
    if (prev === undefined) delete process.env["SMPHE_TOKEN_FILE"]; else process.env["SMPHE_TOKEN_FILE"] = prev;
  }
});

test("un SMPHE_TOKEN_FILE vacío no degrada en silencio al token del fichero", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smphe-empty-"));
  const tokenFile = path.join(dir, "token");
  fs.writeFileSync(tokenFile, "\n");   // un secreto montado que no llegó
  const home = path.join(dir, "home");
  fs.mkdirSync(path.join(home, ".config", "smphe"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".config", "smphe", "config.json"),
    JSON.stringify({ version: 1, host: "https://x", token: "el-token-bueno" }),
  );

  const prev = process.env["SMPHE_TOKEN_FILE"];
  process.env["SMPHE_TOKEN_FILE"] = tokenFile;
  try {
    // Antes devolvía token:"" y el CLI te mandaba a re-loguearte.
    assert.throws(
      () => loadConfig({ homeDir: home }),
      (e: unknown) => e instanceof Error && /is empty/.test(e.message),
    );
  } finally {
    if (prev === undefined) delete process.env["SMPHE_TOKEN_FILE"]; else process.env["SMPHE_TOKEN_FILE"] = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("un XDG_CONFIG_HOME relativo se ignora: el token no acaba bajo el cwd", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smphe-rel-"));
  const home = path.join(dir, "home");
  fs.mkdirSync(home, { recursive: true });
  const prevXdg = process.env["XDG_CONFIG_HOME"];
  const prevHome = process.env["HOME"];
  process.env["XDG_CONFIG_HOME"] = "relconf";
  process.env["HOME"] = home;
  try {
    saveConfig({ version: 1, host: "http://x", token: "t" });
    assert.ok(fs.existsSync(path.join(home, ".config", "smphe", "config.json")), "debe caer en ~/.config");
    assert.ok(!fs.existsSync(path.join(process.cwd(), "relconf")), "y NO crear nada bajo el cwd");
  } finally {
    if (prevXdg === undefined) delete process.env["XDG_CONFIG_HOME"]; else process.env["XDG_CONFIG_HOME"] = prevXdg;
    if (prevHome === undefined) delete process.env["HOME"]; else process.env["HOME"] = prevHome;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
