import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface Config {
  readonly version: 1;
  host?: string;
  token?: string;
  activeProject?: number;
}

/** Where new installs put the config: `$XDG_CONFIG_HOME/smphe`, i.e. `~/.config/smphe`. */
const XDG_APP_NAME = "smphe";
/** Where versions before 0.5.0 put it. Still read, never created. */
const LEGACY_DIR_NAME = ".smphe-client";
const CONFIG_FILE_NAME = "config.json";

function xdgConfigDir(homeDir?: string): string {
  const home = homeDir ?? os.homedir();
  // XDG_CONFIG_HOME is ignored when an explicit homeDir is given: that argument
  // exists so tests (and callers) can isolate themselves from the machine.
  const fromEnv = homeDir === undefined ? process.env["XDG_CONFIG_HOME"] : undefined;
  // La spec XDG es explícita: una ruta relativa es inválida y se ignora. Sin
  // esto, un XDG_CONFIG_HOME relativo escribe el token en un directorio colgando
  // del cwd — o sea, dentro del repo en el que estés.
  const base =
    fromEnv !== undefined && fromEnv !== "" && path.isAbsolute(fromEnv)
      ? fromEnv
      : path.join(home, ".config");
  return path.join(base, XDG_APP_NAME);
}

function legacyConfigDir(homeDir?: string): string {
  return path.join(homeDir ?? os.homedir(), LEGACY_DIR_NAME);
}

/**
 * The config file in use, following the XDG Base Directory spec (clig.dev
 * recommends it, and `~/` is not a dumping ground for dotfiles).
 *
 * An existing `~/.smphe-client/config.json` keeps working and keeps being
 * written to: silently moving a file that holds someone's token is not the
 * kind of surprise a patch release should bring. New installs get XDG.
 */
function resolveConfigFile(homeDir?: string): string {
  const legacy = path.join(legacyConfigDir(homeDir), CONFIG_FILE_NAME);
  if (fs.existsSync(legacy)) return legacy;
  return path.join(xdgConfigDir(homeDir), CONFIG_FILE_NAME);
}

function resolveConfigDir(homeDir?: string): string {
  return path.dirname(resolveConfigFile(homeDir));
}

/** Where the config lives right now — for `config show` and for error messages. */
export function configFilePath(homeDir?: string): string {
  return resolveConfigFile(homeDir);
}

/**
 * `SMPHE_HOST` and `SMPHE_TOKEN` win over the config file, the same way
 * `SMPHE_PROJECT` already wins over the saved project.
 *
 * This is not a convenience: without it, pointing the CLI at another server
 * means editing a file in `$HOME`, and anyone who assumes the usual env vars
 * work — a script, a CI job, an agent verifying a change — keeps talking to
 * whatever instance the config has. That happened here, against production.
 */
function applyEnvOverrides(config: Config): Config {
  const host = process.env["SMPHE_HOST"];
  const tokenFile = process.env["SMPHE_TOKEN_FILE"];
  const token = process.env["SMPHE_TOKEN"];

  // A token in the environment leaks: it is inherited by every child process,
  // shows up in `docker inspect` and in systemd's unit state, and ends up in
  // crash dumps. clig.dev says outright not to put secrets there, so the file
  // form wins over it — that is the one CI and containers should use.
  let resolvedToken: string | undefined;
  if (tokenFile !== undefined && tokenFile !== "") {
    let contents: string;
    try {
      contents = fs.readFileSync(tokenFile, "utf-8");
    } catch (e) {
      // `loadConfig` corre en TODOS los comandos, incluido el `config show` al
      // que acudes a diagnosticar: un ENOENT pelado aquí deja sin salida.
      throw new Error(
        `SMPHE_TOKEN_FILE=${tokenFile} cannot be read: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    }
    resolvedToken = contents.trim();
    if (resolvedToken === "") {
      // Un secreto montado vacío (un /run/secrets que no llegó) degradaba a "" y
      // el error acababa siendo "Token not configured. Run: smphe login", que
      // manda a re-loguearte cuando el token guardado está perfecto.
      throw new Error(`SMPHE_TOKEN_FILE=${tokenFile} is empty: the secret did not arrive`);
    }
  } else if (token !== undefined && token !== "") {
    resolvedToken = token;
  }

  return {
    ...config,
    ...(host !== undefined && host !== "" && { host }),
    ...(resolvedToken !== undefined && { token: resolvedToken }),
  };
}

export function loadConfig(opts?: { homeDir?: string }): Config {
  const filePath = resolveConfigFile(opts?.homeDir);

  if (!fs.existsSync(filePath)) {
    return applyEnvOverrides({ version: 1 });
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

  return applyEnvOverrides(parsed as Config);
}

export function saveConfig(config: Config, opts?: { homeDir?: string }): void {
  const dir = resolveConfigDir(opts?.homeDir);
  const filePath = resolveConfigFile(opts?.homeDir);

  // El fichero guarda un token en claro. El `mode` de mkdir lo recorta la umask
  // y no se aplica si el directorio ya existía —creado con 755 por versiones
  // anteriores—, así que el chmod explícito es el que de verdad lo cierra.
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
  fs.chmodSync(filePath, 0o600);
}

export function mergeConfig(
  current: Config,
  partial: Partial<Omit<Config, "version">>,
): Config {
  return { ...current, ...partial };
}
