import { SemaphoreClient } from "../client.js";
import type { Config } from "./config.js";

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

export async function runHandler(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
  process.exit(0);
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

export function buildClient(config: Config): SemaphoreClient {
  if (!config.host) {
    throw new Error("Host not configured. Run: smphe config set host <url>");
  }
  if (!config.token) {
    throw new Error(
      "Token not configured. Run: smphe login --token <token>",
    );
  }

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
