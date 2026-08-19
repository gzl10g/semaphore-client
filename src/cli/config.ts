import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface Config {
  readonly version: 1;
  host?: string;
  token?: string;
  activeProject?: number;
}

const CONFIG_DIR_NAME = ".smphe-client";
const CONFIG_FILE_NAME = "config.json";

function resolveConfigDir(homeDir?: string): string {
  return path.join(homeDir ?? os.homedir(), CONFIG_DIR_NAME);
}

function resolveConfigFile(homeDir?: string): string {
  return path.join(resolveConfigDir(homeDir), CONFIG_FILE_NAME);
}

export function loadConfig(opts?: { homeDir?: string }): Config {
  const filePath = resolveConfigFile(opts?.homeDir);

  if (!fs.existsSync(filePath)) {
    return { version: 1 };
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed: unknown = JSON.parse(raw);

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Record<string, unknown>)["version"] !== 1
  ) {
    throw new Error(`Invalid config file at ${filePath}: expected version 1`);
  }

  return parsed as Config;
}

export function saveConfig(config: Config, opts?: { homeDir?: string }): void {
  const dir = resolveConfigDir(opts?.homeDir);
  const filePath = resolveConfigFile(opts?.homeDir);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
  fs.chmodSync(filePath, 0o600);
}

export function mergeConfig(
  current: Config,
  partial: Partial<Omit<Config, "version">>,
): Config {
  return { ...current, ...partial };
}
