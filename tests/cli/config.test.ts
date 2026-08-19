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

test("saveConfig creates directory and file if they do not exist", () => {
  const homeDir = uniqueTmpDir();
  const config: Config = { version: 1, host: "http://test.local" };

  saveConfig(config, { homeDir });

  const configFile = path.join(homeDir, ".smphe-client", "config.json");
  assert.ok(fs.existsSync(configFile), "config file should exist");
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
