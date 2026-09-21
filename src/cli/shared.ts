import { SemaphoreClient } from "../client.js";
import { InvalidArgumentError } from "commander";
import { SemaphoreApiError } from "../error.js";
import { loadConfig, type Config } from "./config.js";

export interface ResolveProjectOptions {
  flag?: number;
  env?: string;
  config?: Config;
}

export interface HandlerDeps {
  config?: Config;
  client?: SemaphoreClient;
  homeDir?: string;
}

export interface TableColumn {
  key: string;
  label: string;
  width?: number;
}

/**
 * Waits until stdout has actually been flushed.
 *
 * When stdout is a pipe, Node writes asynchronously: calling process.exit()
 * right after console.log() can cut the output at the pipe buffer size (64 KB
 * on Linux, 8 KB in some setups), so `smphe ... --json | jq` would receive
 * truncated JSON while redirecting to a file worked fine.
 */
async function flushStdout(): Promise<void> {
  if (process.stdout.writableLength === 0) return;
  await new Promise<void>((resolve) => {
    process.stdout.write("", () => {
      resolve();
    });
  });
}

/**
 * Whether the invocation asked for JSON. Read from argv on purpose: `--json` is
 * declared both globally and per subcommand, and the error path has no access
 * to either parsed set.
 */
export function wantsJson(): boolean {
  return process.argv.includes("--json");
}

/**
 * The JSON an failed `--json` invocation prints.
 *
 * Extracted from `runHandler` so it can be tested without spawning the binary:
 * `runHandler` ends in `process.exit()`, which no in-process test can survive.
 *
 * `status`, `method` and `endpoint` appear **only** for a `SemaphoreApiError`,
 * because inventing `status: undefined` for a local validation error would make
 * a caller believe the server answered.
 */
export function formatErrorJson(err: unknown, hint: string | null): string {
  const message = err instanceof Error ? err.message : String(err);
  const api = err instanceof SemaphoreApiError ? err : undefined;

  return JSON.stringify({
    error: {
      message,
      ...(api !== undefined && {
        status: api.status,
        ...(api.method !== undefined && { method: api.method }),
        ...(api.endpoint !== undefined && { endpoint: api.endpoint }),
      }),
      ...(hint !== null && hint !== "" && { hint }),
    },
  }, null, 2);
}

export async function runHandler(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const hint = await denialHint(err);

    // A command that promises `--json` has to fail in JSON too: a caller piping
    // to jq got prose on stderr and a broken pipe on stdout.
    //
    // It goes to **stderr**, like the prose it replaces: stdout carries the
    // command's answer, and a `| jq` that swallowed errors as if they were data
    // would be worse than the problem being fixed. `$?` is still 1.
    if (wantsJson()) {
      console.error(formatErrorJson(err, hint));
    } else {
      console.error(`Error: ${message}`);
      if (hint) console.error(`  ${hint}`);
    }

    await flushStdout();
    process.exit(1);
  }
  await flushStdout();
  process.exit(0);
}

/**
 * What a mutation prints. With `--json` the eight `update` commands used to
 * answer `Template 47 updated`, which is not JSON and broke anyone piping it.
 */
export function reportMutation(
  opts: { json?: boolean },
  result: Record<string, unknown> & { message: string },
): void {
  if (opts.json === true) {
    const { message, ...rest } = result;
    console.log(JSON.stringify({ ok: true, message, ...rest }, null, 2));
    return;
  }
  console.log(result.message);
}

/**
 * Best-effort explanation for a permission failure. Never throws: a broken
 * config or an unreachable server must not hide the original error.
 */
async function denialHint(err: unknown): Promise<string | null> {
  if (!(err instanceof SemaphoreApiError)) return null;
  if (err.status !== 403 && err.status !== 401) return null;
  try {
    const { explainDenied } = await import("./permissions-hint.js");
    let client: SemaphoreClient | undefined;
    try {
      client = buildClient(loadConfig({}));
    } catch {
      client = undefined;
    }
    return await explainDenied(err, client);
  } catch {
    return null;
  }
}

export function resolveProject(opts: ResolveProjectOptions): number {
  if (opts.flag !== undefined) {
    return validateProjectId(opts.flag, "flag");
  }

  if (opts.env !== undefined) {
    const parsed = parseInt(opts.env, 10);
    if (isNaN(parsed)) {
      throw new Error(
        `Invalid SMPHE_PROJECT value "${opts.env}": must be a positive integer`,
      );
    }
    return validateProjectId(parsed, "SMPHE_PROJECT");
  }

  if (opts.config?.activeProject !== undefined) {
    return validateProjectId(opts.config.activeProject, "config");
  }

  throw new Error(
    "No project specified. Use --project <id>, set SMPHE_PROJECT env var, or run: smphe project use <id>",
  );
}

function validateProjectId(value: number, source: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `Invalid project ID ${value} from ${source}: must be a positive integer`,
    );
  }
  return value;
}

/**
 * Hosts a development run is allowed to touch: the throwaway Semaphore that the
 * `semaphore-test-instance` skill starts in Docker, and nothing else.
 */
function isLocalHost(host: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(host).hostname;
  } catch {
    return false;
  }
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    // `new URL("http://[::1]:3010").hostname` devuelve "[::1]", CON corchetes.
    hostname === "[::1]" ||
    hostname === "host.docker.internal" ||
    hostname.endsWith(".localhost")
  );
}

/** `localhost:3010` no lanza en `new URL` (protocolo "localhost:"), pero no es una URL usable. */
function looksLikeUrl(host: string): boolean {
  try {
    const parsed = new URL(host);
    return parsed.hostname !== "" && (parsed.protocol === "http:" || parsed.protocol === "https:");
  } catch {
    return false;
  }
}

/**
 * With `NODE_ENV=development`, refuse to talk to a remote Semaphore.
 *
 * Verifying a change against the instance people actually depend on is how a
 * review of this package ended up writing to a production project: the repro
 * exported env vars the CLI did not read, so it silently used the saved config.
 * A rule in a document does not stop that; a refusal does.
 *
 * `SMPHE_ALLOW_REMOTE=1` is the escape hatch, and it has to be typed on purpose.
 */
function assertDevelopmentTargetsTestInstance(host: string): void {
  if (process.env["NODE_ENV"] !== "development") return;
  if (process.env["SMPHE_ALLOW_REMOTE"] === "1") return;
  if (isLocalHost(host)) return;

  if (!looksLikeUrl(host)) {
    throw new Error(
      `"${host}" is not a usable URL: it needs a scheme, e.g. http://localhost:3010`,
    );
  }

  throw new Error(
    `NODE_ENV=development refuses to touch ${host}: development runs go against the ` +
      "throwaway Semaphore in Docker (skill `semaphore-test-instance`), not a shared one. " +
      "Point SMPHE_HOST at it, or set SMPHE_ALLOW_REMOTE=1 if you really mean this host.",
  );
}

export function buildClient(config: Config): SemaphoreClient {
  if (!config.host) {
    throw new Error("Host not configured. Run: smphe config set host <url>");
  }
  if (!config.token) {
    throw new Error(
      "Token not configured. Run: echo \"$TOKEN\" | smphe login --token-stdin",
    );
  }

  assertDevelopmentTargetsTestInstance(config.host);

  return new SemaphoreClient({
    baseUrl: config.host,
    apiToken: config.token,
  });
}

export function formatTable(
  rows: Record<string, unknown>[],
  columns: TableColumn[],
): string {
  const widths = columns.map((col) => {
    const dataMax = rows.reduce((max, row) => {
      const val = String(row[col.key] ?? "");
      return Math.max(max, val.length);
    }, 0);
    return col.width ?? Math.max(col.label.length, dataMax);
  });

  const header = columns
    .map((col, i) => col.label.padEnd(widths[i]))
    .join("  ");

  const separator = widths.map((w) => "─".repeat(w)).join("  ");

  const dataRows = rows.map((row) =>
    columns.map((col, i) => String(row[col.key] ?? "").padEnd(widths[i])).join("  "),
  );

  return [header, separator, ...dataRows].join("\n");
}

export function formatOutput(
  data: unknown,
  opts: { json?: boolean },
  columns?: TableColumn[],
): void {
  if (opts.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (Array.isArray(data) && columns && columns.length > 0) {
    console.log(formatTable(data as Record<string, unknown>[], columns));
    return;
  }

  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      console.log(`${key}: ${String(value ?? "")}`);
    }
    return;
  }

  console.log(String(data));
}

/** Apps cuyo `arguments` acepta el formato por stages. */
const TERRAFORM_APPS = new Set(["terraform", "tofu", "terragrunt"]);

/**
 * `arguments` es un STRING que contiene JSON, y el servidor acepta DOS formas
 * (`convertArgsJSONIfArray` en `services/tasks/local_executor.go`):
 *
 * - `["--tags","deploy"]` — la lista de flags, válida en cualquier app.
 * - `{"init":["-upgrade"],"apply":["-parallelism=4"]}` — un mapa cuyas claves
 *   son STAGES, y que solo tiene sentido en terraform/tofu/terragrunt: ahí es
 *   una funcionalidad del servidor, no un error. En ansible/bash/python el
 *   ejecutor deserializa a `[]string`, así que el mapa se guarda y revienta al
 *   ejecutar.
 *
 * Por eso la forma se valida contra el `app` cuando se conoce, y cuando no se
 * conoce se aceptan las dos: rechazar a ciegas rompería las plantillas
 * Terraform, que es justo lo que pasó la primera vez que escribí esto.
 */
export function validateArgumentsShape(args: string | undefined, app?: string): void {
  if (args === undefined) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    throw new Error(
      `--arguments must be JSON: a list of flags like '["--tags","deploy"]'` +
        `, or a map of stages for terraform apps. Got: ${args}`,
    );
  }

  const isFlagList = Array.isArray(parsed) && parsed.every((a) => typeof a === "string");
  const isStageMap =
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    Object.values(parsed as Record<string, unknown>).every(
      (v) => Array.isArray(v) && v.every((a) => typeof a === "string"),
    );

  if (isFlagList) return;

  if (isStageMap) {
    if (app === undefined || TERRAFORM_APPS.has(app)) return;
    throw new Error(
      `--arguments as a map of stages only works for terraform, tofu and terragrunt templates; ` +
        `${app} needs a list of flags like '["--tags","deploy"]'`,
    );
  }

  throw new Error(
    `--arguments must be a JSON list of strings like '["--tags","deploy"]'` +
      (app === undefined || TERRAFORM_APPS.has(app)
        ? `, or a map of string lists per stage like '{"init":["-upgrade"]}'`
        : "") +
      `. Got: ${args}`,
  );
}

/**
 * Un flag numérico del CLI.
 *
 * Rechaza lo que no sea un entero en vez de devolver `NaN`, porque `NaN` **no**
 * es `undefined`: sobrevive a `mergeForUpdate`, `JSON.stringify` lo convierte en
 * `null` y el servidor lo persiste. Un typo en `--auth-secret-id` DESENGANCHABA
 * la credencial de una integración autenticada y el CLI respondía "updated".
 * Mismo motivo por el que `parseIntListOption` ya lo hacía.
 *
 * Acepta ceros a la izquierda a propósito: `--project 007` funcionaba con el
 * `parseInt` de antes y no hay nada ambiguo en él, así que rechazarlo sería un
 * rechazo NUEVO en comandos que ya existían. Lo que se rechaza es lo que
 * `parseInt` aceptaba en silencio truncando: `3.5` (→3), `1e3` (→1), `12abc`
 * (→12), y lo que daba `NaN`: `abc` y la cadena vacía.
 */
export function parseIntOption(v: string): number {
  const trimmed = v.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) {
    throw new InvalidArgumentError(`expected an integer, got "${v}"`);
  }
  return parseInt(trimmed, 10);
}
