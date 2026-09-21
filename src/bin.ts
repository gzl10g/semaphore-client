#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command, InvalidArgumentError } from "commander";
import { runHandler, parseIntOption } from "./cli/shared.js";
import type {
  IntegrationAuthMethod,
  IntegrationMatchType,
  IntegrationMatchMethod,
  IntegrationBodyDataType,
  IntegrationValueSource,
  IntegrationVariableType,
} from "./types.js";

/**
 * Los `task_params` de un template ansible: los valores propios (limit, tags,
 * skip tags, galaxy) y los flags que deciden si una task puede sobreescribirlos
 * — las casillas "Ansible prompts" de la UI.
 */
function buildAnsibleParams(opts: Record<string, unknown>): Record<string, unknown> | undefined {
  const params: Record<string, unknown> = {};
  if (opts["limit"] !== undefined) params["limit"] = opts["limit"];
  if (opts["tags"] !== undefined) params["tags"] = opts["tags"];
  if (opts["skipTags"] !== undefined) params["skip_tags"] = opts["skipTags"];
  if (opts["skipGalaxyInstall"] !== undefined) params["skip_galaxy_install"] = opts["skipGalaxyInstall"];
  if (opts["allowOverrideLimit"] !== undefined) params["allow_override_limit"] = opts["allowOverrideLimit"];
  if (opts["allowOverrideTags"] !== undefined) params["allow_override_tags"] = opts["allowOverrideTags"];
  if (opts["allowOverrideSkipTags"] !== undefined) params["allow_override_skip_tags"] = opts["allowOverrideSkipTags"];
  if (opts["allowOverrideInventory"] !== undefined) params["allow_override_inventory"] = opts["allowOverrideInventory"];
  if (opts["allowDebug"] !== undefined) params["allow_debug"] = opts["allowDebug"];
  return Object.keys(params).length > 0 ? params : undefined;
}

/**
 * `--args` de una app: el servidor guarda la lista serializada, y una lista
 * vacía la borra (`setApp` manda `nil` cuando el JSON queda en `[]`). Se valida
 * la forma aquí porque un `--args '"x"'` se guardaría sin rechistar y el fallo
 * aparecería al ejecutar la app, no al configurarla.
 */
const parseStringListOption = (v: string): string[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(v);
  } catch {
    throw new InvalidArgumentError(`--args must be a JSON array of strings, e.g. '["--no-color"]'. Got: ${v}`);
  }
  if (!Array.isArray(parsed) || !parsed.every((a) => typeof a === "string")) {
    throw new InvalidArgumentError(`--args must be a JSON array of strings, e.g. '["--no-color"]'. Got: ${v}`);
  }
  return parsed as string[];
};

const parseIntListOption = (v: string): number[] => {
  const parts = v.split(",").map((part) => part.trim()).filter((part) => part !== "");
  if (parts.length === 0) {
    throw new InvalidArgumentError("expected a comma-separated list of IDs, got nothing");
  }
  return parts.map((part) => {
    const n = parseInt(part, 10);
    if (Number.isNaN(n) || String(n) !== part) {
      throw new InvalidArgumentError(`expected a comma-separated list of IDs, got "${part}"`);
    }
    return n;
  });
};

/**
 * Enum flags of `integrations`. Commander hands strings through untouched, and
 * the server stores an unknown value without complaining: an integration with
 * `auth_method: "toekn"` falls into the receiver's `default` branch and drops
 * every request in silence. So they are checked here, where the message can
 * still name the flag.
 */
function parseEnumOption<T extends string>(flag: string, allowed: readonly T[], value: string): T;
function parseEnumOption<T extends string>(
  flag: string,
  allowed: readonly T[],
  value: string | undefined,
): T | undefined;
function parseEnumOption<T extends string>(
  flag: string,
  allowed: readonly T[],
  value: string | undefined,
): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`${flag} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

/** `none` is the CLI's name for the server's empty auth method. */
const parseAuthMethod = (v: string | undefined): IntegrationAuthMethod | undefined => {
  if (v === undefined) return undefined;
  const method = parseEnumOption(
    "--auth-method",
    ["none", "github", "bitbucket", "hmac", "token", "basic"] as const,
    v,
  );
  // `none` is the CLI's name for the server's empty auth method.
  return method === "none" ? "" : method;
};

function parseMatchType(v: string): IntegrationMatchType;
function parseMatchType(v: string | undefined): IntegrationMatchType | undefined;
function parseMatchType(v: string | undefined): IntegrationMatchType | undefined {
  return parseEnumOption("--match-type", ["header", "body"] as const, v);
}

function parseMatchMethod(v: string): IntegrationMatchMethod;
function parseMatchMethod(v: string | undefined): IntegrationMatchMethod | undefined;
function parseMatchMethod(v: string | undefined): IntegrationMatchMethod | undefined {
  return parseEnumOption("--method", ["equals", "unequals", "contains"] as const, v);
}

function parseBodyDataType(v: string): IntegrationBodyDataType;
function parseBodyDataType(v: string | undefined): IntegrationBodyDataType | undefined;
function parseBodyDataType(v: string | undefined): IntegrationBodyDataType | undefined {
  return parseEnumOption("--body-data-type", ["json", "string"] as const, v);
}

function parseValueSource(v: string): IntegrationValueSource;
function parseValueSource(v: string | undefined): IntegrationValueSource | undefined;
function parseValueSource(v: string | undefined): IntegrationValueSource | undefined {
  return parseEnumOption("--value-source", ["body", "header"] as const, v);
}

function parseVariableType(v: string): IntegrationVariableType;
function parseVariableType(v: string | undefined): IntegrationVariableType | undefined;
function parseVariableType(v: string | undefined): IntegrationVariableType | undefined {
  return parseEnumOption("--variable-type", ["environment", "task"] as const, v);
}

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string };

const program = new Command();

/**
 * Commander escribe sus propios errores —opción desconocida, valor inválido de
 * un parser como `parseIntOption`— ANTES de que `runHandler` exista, así que
 * `--json` recibía texto suelto justo en el caso en que más se necesita el
 * formato: una entrada inválida.
 */
program.configureOutput({
  outputError: (str, write) => {
    if (!process.argv.includes("--json")) {
      write(str);
      return;
    }
    const message = str.replace(/^error:\s*/i, "").trim();
    write(`${JSON.stringify({ error: { message } }, null, 2)}\n`);
  },
});

program
  .name("smphe")
  .description("Semaphore UI CLI — manage Ansible/Terraform automation from the command line")
  .version(pkg.version)
  .option("--json", "Output as JSON")
  .addHelpText(
    "after",
    `
Setup:
  smphe config set host http://semaphore.example.com:3000
  echo "$YOUR_API_TOKEN" | smphe login --token-stdin
  smphe use <projectId>

Quick start:
  smphe templates list --json          # find template IDs
  smphe tasks run <templateId>         # run a playbook
  smphe tasks get <taskId> --json      # poll status
  smphe tasks output <taskId>          # view output

Configuration (flags > environment > config file):
  host      SMPHE_HOST, then the config file
  token     SMPHE_TOKEN_FILE (a path), then SMPHE_TOKEN, then the config file
  project   --project <id>, then SMPHE_PROJECT, then "smphe use <id>"

  File: ~/.config/smphe/config.json (dir 700, file 600). An older
  ~/.smphe-client/config.json keeps being used if present.
  Secrets do not belong in environment variables: prefer SMPHE_TOKEN_FILE.
  "smphe config show" says where each value comes from.

All read commands accept --json for machine-readable output (pipe to jq).
See also: llms.txt for a full command reference optimised for AI agents.`,
  );

const configCmd = program.command("config").description("Manage configuration");

configCmd
  .command("set <key> <value>")
  .description("Set a configuration value (host, token)")
  .action(async (key: string, value: string) => {
    await runHandler(async () => {
      const { handleConfigSet } = await import("./cli/config-command.js");
      await handleConfigSet(key, value);
    });
  });

configCmd
  .command("show")
  .description("Show current configuration")
  .action(async () => {
    await runHandler(async () => {
      const { handleConfigShow } = await import("./cli/config-command.js");
      await handleConfigShow();
    });
  });

program
  .command("whoami")
  .description("Show which user the token belongs to and what it is allowed to do")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleWhoami } = await import("./cli/whoami.js");
      await handleWhoami(opts.project, { json: opts.json ?? program.opts().json });
    });
  });

program
  .command("login")
  .description("Authenticate with a token")
  .option("--token-stdin", "Read the API token from stdin — it stays out of your shell history and out of `ps`")
  .option("--token <token>", "API token. Discouraged: argv is visible to other processes")
  .action(async (opts: { token?: string; tokenStdin?: boolean }) => {
    await runHandler(async () => {
      const { handleLoginToken } = await import("./cli/config-command.js");
      await handleLoginToken({ token: opts.token, tokenStdin: opts.tokenStdin });
    });
  });

program
  .command("use <projectId>")
  .description("Set the active project")
  .action(async (projectId: string) => {
    await runHandler(async () => {
      const { handleUseProject } = await import("./cli/config-command.js");
      await handleUseProject(parseInt(projectId, 10));
    });
  });

const projectsCmd = program.command("projects").description("Manage projects");

projectsCmd
  .command("list")
  .description("List all projects")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    await runHandler(async () => {
      const { handleProjectsList } = await import("./cli/projects.js");
      await handleProjectsList({ json: opts.json ?? program.opts().json });
    });
  });

projectsCmd
  .command("get <id>")
  .description("Get a project by ID")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { json?: boolean }) => {
    await runHandler(async () => {
      const { handleProjectsGet } = await import("./cli/projects.js");
      await handleProjectsGet(parseInt(id, 10), { json: opts.json ?? program.opts().json });
    });
  });

projectsCmd
  .command("create")
  .description("Create a new project")
  .requiredOption("--name <name>", "Project name")
  .option("--alert", "Enable alerts")
  .option("--alert-chat <chat>", "Alert chat destination")
  .option("--max-parallel-tasks <n>", "Max parallel tasks")
  .option("--json", "Output as JSON")
  .action(async (opts: { name: string; alert?: boolean; alertChat?: string; maxParallelTasks?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleProjectsCreate } = await import("./cli/projects.js");
      await handleProjectsCreate(
        {
          name: opts.name,
          alert: opts.alert,
          alertChat: opts.alertChat,
          maxParallelTasks: opts.maxParallelTasks !== undefined ? parseInt(opts.maxParallelTasks, 10) : undefined,
        },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

projectsCmd
  .command("update <id>")
  .description("Update a project")
  .option("--name <name>", "New project name")
  .option("--alert", "Enable alerts")
  .option("--no-alert", "Disable alerts")
  .option("--alert-chat <chat>", "Alert chat destination")
  .option("--max-parallel-tasks <n>", "Max parallel tasks")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { name?: string; alert?: boolean; alertChat?: string; maxParallelTasks?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleProjectsUpdate } = await import("./cli/projects.js");
      await handleProjectsUpdate(
        parseInt(id, 10),
        {
          name: opts.name,
          alert: opts.alert,
          alertChat: opts.alertChat,
          maxParallelTasks: opts.maxParallelTasks !== undefined ? parseInt(opts.maxParallelTasks, 10) : undefined,
        },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

projectsCmd
  .command("test-alerts <id>")
  .description("Send a test alert through the project's configured channel")
  .action(async (id: string) => {
    await runHandler(async () => {
      const { handleProjectsTestAlerts } = await import("./cli/projects.js");
      await handleProjectsTestAlerts(parseInt(id, 10));
    });
  });

projectsCmd
  .command("clear-cache <id>")
  .description("Delete the project's cached repository clones (irreversible)")
  .option("--yes", "Skip confirmation")
  .action(async (id: string, opts: { yes?: boolean }) => {
    await runHandler(async () => {
      const { handleProjectsClearCache } = await import("./cli/projects.js");
      await handleProjectsClearCache(parseInt(id, 10), { yes: opts.yes });
    });
  });

projectsCmd
  .command("delete <id>")
  .description("Delete a project")
  .option("--yes", "Skip confirmation prompt")
  .action(async (id: string, opts: { yes?: boolean }) => {
    await runHandler(async () => {
      const { handleProjectsDelete } = await import("./cli/projects.js");
      await handleProjectsDelete(parseInt(id, 10), opts);
    });
  });

const appsCmd = program.command("apps").description("Apps a template can use (ansible, terraform, terragrunt…)");

appsCmd
  .command("list")
  .description("List the apps this instance has configured")
  .option("--all", "Include the ones the instance has disabled")
  .option("--json", "Output as JSON")
  .action(async (opts: { all?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleAppsList } = await import("./cli/apps.js");
      await handleAppsList({ json: opts.json ?? program.opts().json, all: opts.all });
    });
  });


appsCmd
  .command("get <appId>")
  .description("Show one app (admin)")
  .option("--json", "Output as JSON")
  .action(async (appId: string, opts: { json?: boolean }) => {
    await runHandler(async () => {
      const { handleAppsGet } = await import("./cli/apps.js");
      await handleAppsGet(appId, { json: opts.json ?? program.opts().json });
    });
  });

appsCmd
  .command("set <appId>")
  .description("Create or update an app (admin). An unknown id creates it")
  .option("--title <title>", "Display name")
  .option("--icon <icon>", "Icon name")
  .option("--color <color>", "Colour")
  .option("--dark-color <color>", "Colour for dark mode")
  .option("--path <path>", "Executable the app runs")
  .option("--args <json>", "Fixed CLI args as a JSON array, e.g. '[\"--no-color\"]'", parseStringListOption)
  .option("--priority <n>", "Sort order in the UI", parseIntOption)
  .option("--active", "Enable it")
  .option("--no-active", "Disable it")
  .option("--json", "Output as JSON")
  .action(async (appId: string, opts: { title?: string; icon?: string; color?: string; darkColor?: string; path?: string; args?: string[]; priority?: number; active?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleAppsSet } = await import("./cli/apps.js");
      await handleAppsSet(
        appId,
        { title: opts.title, icon: opts.icon, color: opts.color, darkColor: opts.darkColor, path: opts.path, args: opts.args, priority: opts.priority, active: opts.active },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

appsCmd
  .command("enable <appId>")
  .description("Enable an app without rewriting the rest of it (admin)")
  .option("--json", "Output as JSON")
  .action(async (appId: string, opts: { json?: boolean }) => {
    await runHandler(async () => {
      const { handleAppsSetActive } = await import("./cli/apps.js");
      await handleAppsSetActive(appId, true, { json: opts.json ?? program.opts().json });
    });
  });

appsCmd
  .command("disable <appId>")
  .description("Disable an app without rewriting the rest of it (admin)")
  .option("--json", "Output as JSON")
  .action(async (appId: string, opts: { json?: boolean }) => {
    await runHandler(async () => {
      const { handleAppsSetActive } = await import("./cli/apps.js");
      await handleAppsSetActive(appId, false, { json: opts.json ?? program.opts().json });
    });
  });

appsCmd
  .command("delete <appId>")
  .description("Remove an app from the whole instance (admin)")
  .option("--yes", "Skip confirmation")
  .action(async (appId: string, opts: { yes?: boolean }) => {
    await runHandler(async () => {
      const { handleAppsDelete } = await import("./cli/apps.js");
      await handleAppsDelete(appId, { yes: opts.yes });
    });
  });

// ── roles globales (admin) ──
const rolesCmd = program.command("roles").description("Global roles (admin)");

rolesCmd
  .command("list")
  .description("List the global roles")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    await runHandler(async () => {
      const { handleRolesList } = await import("./cli/admin.js");
      await handleRolesList({ json: opts.json ?? program.opts().json });
    });
  });

rolesCmd
  .command("get <slug>")
  .description("Show one global role")
  .option("--json", "Output as JSON")
  .action(async (slug: string, opts: { json?: boolean }) => {
    await runHandler(async () => {
      const { handleRolesGet } = await import("./cli/admin.js");
      await handleRolesGet(slug, { json: opts.json ?? program.opts().json });
    });
  });

rolesCmd
  .command("create <slug>")
  .description("Create a global role")
  .requiredOption("--name <name>", "Display name")
  .option("--permissions <bitmask>", "Permission bitmask (1 run_tasks, 2 update_project, 4 manage_resources, 8 manage_users)", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (slug: string, opts: { name: string; permissions?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleRolesCreate } = await import("./cli/admin.js");
      await handleRolesCreate(slug, opts.name, opts.permissions, { json: opts.json ?? program.opts().json });
    });
  });

rolesCmd
  .command("update <slug>")
  .description("Update a global role. What you omit is kept")
  .option("--name <name>", "Display name")
  .option("--permissions <bitmask>", "Permission bitmask", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (slug: string, opts: { name?: string; permissions?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleRolesUpdate } = await import("./cli/admin.js");
      await handleRolesUpdate(slug, { name: opts.name, permissions: opts.permissions }, { json: opts.json ?? program.opts().json });
    });
  });

rolesCmd
  .command("delete <slug>")
  .description("Delete a global role")
  .option("--yes", "Skip confirmation")
  .action(async (slug: string, opts: { yes?: boolean }) => {
    await runHandler(async () => {
      const { handleRolesDelete } = await import("./cli/admin.js");
      await handleRolesDelete(slug, { yes: opts.yes });
    });
  });

// ── pool de tasks de la instancia (admin) ──
const instanceCmd = program
  .command("instance")
  .description("Instance-wide administration (admin): the live task pool");

instanceCmd
  .command("tasks")
  .description("Tasks queued or running right now, across every project")
  .option("--queued", "Only the ones waiting for a slot")
  .option("--running", "Only the ones executing")
  .option("--json", "Output as JSON")
  .action(async (opts: { queued?: boolean; running?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleInstanceTasksList } = await import("./cli/admin.js");
      await handleInstanceTasksList({ json: opts.json ?? program.opts().json, queued: opts.queued, running: opts.running });
    });
  });

instanceCmd
  .command("stop <taskId>")
  .description("Stop a queued or running task, whatever project it belongs to")
  .option("--json", "Output as JSON")
  .action(async (taskId: string, opts: { json?: boolean }) => {
    await runHandler(async () => {
      const { handleInstanceTasksStop } = await import("./cli/admin.js");
      await handleInstanceTasksStop(parseInt(taskId, 10), { json: opts.json ?? program.opts().json });
    });
  });

// ── tasks ──
const tasksCmd = program.command("tasks").description("Manage tasks");

tasksCmd
  .command("list")
  .description("List tasks in a project")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option(
    "--status <status>",
    "Filter by status (waiting|starting|waiting_confirmation|confirmed|rejected|running|stopping|stopped|error|success)",
  )
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; status?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleTasksList } = await import("./cli/tasks.js");
      await handleTasksList(opts.project, { json: opts.json ?? program.opts().json, status: opts.status });
    });
  });

tasksCmd
  .command("get <taskId>")
  .description("Get a task by ID")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (taskId: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleTasksGet } = await import("./cli/tasks.js");
      await handleTasksGet(opts.project, parseInt(taskId, 10), { json: opts.json ?? program.opts().json });
    });
  });

tasksCmd
  .command("run <templateId>")
  .description("Run a task from a template")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--debug", "Enable debug mode")
  .option("--dry-run", "Dry run mode")
  .option("--playbook <file>", "Override playbook file")
  .option("--environment <env>", "Override environment variables")
  .option("--limit <hosts>", "Limit to specific hosts")
  .option("--arguments <json>", "Extra arguments as JSON string")
  .option("--json", "Output as JSON")
  .action(async (templateId: string, opts: { project?: number; debug?: boolean; dryRun?: boolean; playbook?: string; environment?: string; limit?: string; arguments?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleTasksRun } = await import("./cli/tasks.js");
      await handleTasksRun(
        opts.project,
        parseInt(templateId, 10),
        {
          debug: opts.debug,
          dryRun: opts.dryRun,
          playbook: opts.playbook,
          environment: opts.environment,
          limit: opts.limit,
          arguments: opts.arguments,
        },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

tasksCmd
  .command("stop <taskId>")
  .description("Stop a running task")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--force", "Kill it instead of asking it to finish the current step")
  .option("--json", "Output as JSON")
  .action(async (taskId: string, opts: { project?: number; force?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleTasksStop } = await import("./cli/tasks.js");
      await handleTasksStop(opts.project, parseInt(taskId, 10), {
        json: opts.json ?? program.opts().json,
        force: opts.force,
      });
    });
  });

tasksCmd
  .command("confirm <taskId>")
  .description("Approve a task waiting at an approval gate")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .action(async (taskId: string, opts: { project?: number }) => {
    await runHandler(async () => {
      const { handleTasksConfirm } = await import("./cli/tasks.js");
      await handleTasksConfirm(opts.project, parseInt(taskId, 10));
    });
  });

tasksCmd
  .command("reject <taskId>")
  .description("Reject a task waiting at an approval gate; it will never run")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .action(async (taskId: string, opts: { project?: number }) => {
    await runHandler(async () => {
      const { handleTasksReject } = await import("./cli/tasks.js");
      await handleTasksReject(opts.project, parseInt(taskId, 10));
    });
  });

tasksCmd
  .command("stages <taskId>")
  .description("Stages the run went through (checkout, galaxy install, the playbook…)")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (taskId: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleTasksStages } = await import("./cli/tasks.js");
      await handleTasksStages(opts.project, parseInt(taskId, 10), { json: opts.json ?? program.opts().json });
    });
  });

tasksCmd
  .command("hosts <taskId>")
  .description("Per-host counters as ansible reported them (the PLAY RECAP)")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (taskId: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleTasksHosts } = await import("./cli/tasks.js");
      await handleTasksHosts(opts.project, parseInt(taskId, 10), { json: opts.json ?? program.opts().json });
    });
  });

tasksCmd
  .command("output <taskId>")
  .description("Get output of a task")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (taskId: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleTasksOutput } = await import("./cli/tasks.js");
      await handleTasksOutput(opts.project, parseInt(taskId, 10), { json: opts.json ?? program.opts().json });
    });
  });

// ── templates ──
const templatesCmd = program.command("templates").description("Manage templates");

templatesCmd
  .command("list")
  .description("List templates in a project")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleTemplatesList } = await import("./cli/templates.js");
      await handleTemplatesList(opts.project, { json: opts.json ?? program.opts().json });
    });
  });

templatesCmd
  .command("get <id>")
  .description("Get a template by ID")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleTemplatesGet } = await import("./cli/templates.js");
      await handleTemplatesGet(opts.project, parseInt(id, 10), { json: opts.json ?? program.opts().json });
    });
  });

templatesCmd
  .command("create")
  .description("Create a template")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .requiredOption("--name <name>", "Template name")
  .option("--inventory-id <id>", "Inventory ID (required only for ansible templates)", parseIntOption)
  .requiredOption("--repository-id <id>", "Repository ID", parseIntOption)
  .requiredOption("--environment-id <id>", "Environment (variable group) ID", parseIntOption)
  .option("--environment-ids <ids>", "Several variable groups, comma separated (Semaphore >= 2.19). Wins over --environment-id", parseIntListOption)
  .requiredOption("--playbook <file>", "Playbook file")
  .option("--app <app>", "App type (ansible|terraform|tofu|bash|python|powershell)")
  .option("--git-branch <branch>", "Branch to check out for this template (overrides the repository's)")
  .option("--type <type>", "Template type: task (default), build or deploy")
  .option("--start-version <version>", "Starting version of a build template (the BUILD tab)")
  .option("--build-template-id <id>", "Build template a deploy template depends on (the DEPLOY tab)", parseIntOption)
  .option("--view-id <id>", "View (tab) the template belongs to", parseIntOption)
  .option("--arguments <json>", "CLI args as a JSON array string, e.g. '[\"--tags\",\"deploy\"]'")
  .option("--allow-override-args", "Let a task override the CLI args (the 'CLI args' prompt)")
  .option("--allow-override-branch", "Let a task pick the branch (the 'Branch' prompt)")
  .option("--autorun", "Run automatically when the repository gets a new commit")
  .option("--allow-parallel-tasks", "Allow several tasks of this template at once")
  .option("--suppress-success-alerts", "Do not notify on success")
  .option("--runner-tag <tag>", "Pin the template to runners carrying this tag")
  .option("--limit <host...>", "Ansible limit of the template (repeatable)")
  .option("--tags <tag...>", "Ansible tags (repeatable)")
  .option("--skip-tags <tag...>", "Ansible skipped tags (repeatable)")
  .option("--skip-galaxy-install", "Skip the Galaxy install step")
  .option("--allow-override-limit", "Ansible prompt: let a task set the limit")
  .option("--allow-override-tags", "Ansible prompt: let a task set the tags")
  .option("--allow-override-skip-tags", "Ansible prompt: let a task set the skipped tags")
  .option("--allow-override-inventory", "Ansible prompt: let a task pick the inventory")
  .option("--allow-debug", "Ansible prompt: let a task run in debug mode")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; name: string; inventoryId?: number; repositoryId: number; environmentId: number; environmentIds?: number[]; playbook: string; app?: string; gitBranch?: string; type?: string; startVersion?: string; buildTemplateId?: number; viewId?: number; arguments?: string; allowOverrideArgs?: boolean; allowOverrideBranch?: boolean; autorun?: boolean; allowParallelTasks?: boolean; suppressSuccessAlerts?: boolean; runnerTag?: string; limit?: string[]; tags?: string[]; skipTags?: string[]; skipGalaxyInstall?: boolean; allowOverrideLimit?: boolean; allowOverrideTags?: boolean; allowOverrideSkipTags?: boolean; allowOverrideInventory?: boolean; allowDebug?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleTemplatesCreate } = await import("./cli/templates.js");
      await handleTemplatesCreate(
        opts.project,
        {
          name: opts.name,
          inventoryId: opts.inventoryId,
          repositoryId: opts.repositoryId,
          environmentId: opts.environmentId,
          environmentIds: opts.environmentIds,
          playbook: opts.playbook,
          app: opts.app as "ansible" | "terraform" | "tofu" | "bash" | "python" | "powershell" | undefined,
          gitBranch: opts.gitBranch,
          type: opts.type as "" | "build" | "deploy" | undefined,
          startVersion: opts.startVersion,
          buildTemplateId: opts.buildTemplateId,
          viewId: opts.viewId,
          arguments: opts.arguments,
          allowOverrideArgsInTask: opts.allowOverrideArgs,
          allowOverrideBranchInTask: opts.allowOverrideBranch,
          autorun: opts.autorun,
          allowParallelTasks: opts.allowParallelTasks,
          suppressSuccessAlerts: opts.suppressSuccessAlerts,
          runnerTag: opts.runnerTag,
          taskParams: buildAnsibleParams(opts),
        },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

templatesCmd
  .command("update <id>")
  .description("Update a template")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--name <name>", "Template name")
  .option("--inventory-id <id>", "Inventory ID", parseIntOption)
  .option("--repository-id <id>", "Repository ID", parseIntOption)
  .option("--environment-id <id>", "Environment (variable group) ID", parseIntOption)
  .option("--environment-ids <ids>", "Replace the variable groups with this comma-separated list (Semaphore >= 2.19)", parseIntListOption)
  .option("--playbook <file>", "Playbook file")
  .option("--app <app>", "App type")
  .option("--git-branch <branch>", "Branch to check out for this template")
  .option("--type <type>", "Template type: task (default), build or deploy")
  .option("--start-version <version>", "Starting version of a build template (the BUILD tab)")
  .option("--build-template-id <id>", "Build template a deploy template depends on (the DEPLOY tab)", parseIntOption)
  .option("--view-id <id>", "View (tab) the template belongs to", parseIntOption)
  .option("--arguments <json>", "CLI args as a JSON array string, e.g. '[\"--tags\",\"deploy\"]'")
  .option("--allow-override-args", "Let a task override the CLI args (the 'CLI args' prompt)")
  .option("--allow-override-branch", "Let a task pick the branch (the 'Branch' prompt)")
  .option("--autorun", "Run automatically when the repository gets a new commit")
  .option("--allow-parallel-tasks", "Allow several tasks of this template at once")
  .option("--suppress-success-alerts", "Do not notify on success")
  .option("--runner-tag <tag>", "Pin the template to runners carrying this tag")
  .option("--limit <host...>", "Ansible limit of the template (repeatable)")
  .option("--tags <tag...>", "Ansible tags (repeatable)")
  .option("--skip-tags <tag...>", "Ansible skipped tags (repeatable)")
  .option("--skip-galaxy-install", "Skip the Galaxy install step")
  .option("--allow-override-limit", "Ansible prompt: let a task set the limit")
  .option("--allow-override-tags", "Ansible prompt: let a task set the tags")
  .option("--allow-override-skip-tags", "Ansible prompt: let a task set the skipped tags")
  .option("--allow-override-inventory", "Ansible prompt: let a task pick the inventory")
  .option("--allow-debug", "Ansible prompt: let a task run in debug mode")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; name?: string; inventoryId?: number; repositoryId?: number; environmentId?: number; environmentIds?: number[]; playbook?: string; app?: string; gitBranch?: string; type?: string; startVersion?: string; buildTemplateId?: number; viewId?: number; arguments?: string; allowOverrideArgs?: boolean; allowOverrideBranch?: boolean; autorun?: boolean; allowParallelTasks?: boolean; suppressSuccessAlerts?: boolean; runnerTag?: string; limit?: string[]; tags?: string[]; skipTags?: string[]; skipGalaxyInstall?: boolean; allowOverrideLimit?: boolean; allowOverrideTags?: boolean; allowOverrideSkipTags?: boolean; allowOverrideInventory?: boolean; allowDebug?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleTemplatesUpdate } = await import("./cli/templates.js");
      await handleTemplatesUpdate(
        opts.project,
        parseInt(id, 10),
        {
          name: opts.name,
          inventoryId: opts.inventoryId,
          repositoryId: opts.repositoryId,
          environmentId: opts.environmentId,
          environmentIds: opts.environmentIds,
          playbook: opts.playbook,
          app: opts.app as "ansible" | "terraform" | "tofu" | "bash" | "python" | "powershell" | undefined,
          gitBranch: opts.gitBranch,
          type: opts.type as "" | "build" | "deploy" | undefined,
          startVersion: opts.startVersion,
          buildTemplateId: opts.buildTemplateId,
          viewId: opts.viewId,
          arguments: opts.arguments,
          allowOverrideArgsInTask: opts.allowOverrideArgs,
          allowOverrideBranchInTask: opts.allowOverrideBranch,
          autorun: opts.autorun,
          allowParallelTasks: opts.allowParallelTasks,
          suppressSuccessAlerts: opts.suppressSuccessAlerts,
          runnerTag: opts.runnerTag,
          taskParams: buildAnsibleParams(opts),
        },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

templatesCmd
  .command("refs <id>")
  .description("What references this template — ask before deleting it")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleTemplatesRefs } = await import("./cli/templates.js");
      await handleTemplatesRefs(opts.project, parseInt(id, 10), { json: opts.json ?? program.opts().json });
    });
  });

templatesCmd
  .command("stop-all-tasks <id>")
  .description("Stop every running task of this template")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .action(async (id: string, opts: { project?: number }) => {
    await runHandler(async () => {
      const { handleTemplatesStopAll } = await import("./cli/templates.js");
      await handleTemplatesStopAll(opts.project, parseInt(id, 10));
    });
  });

templatesCmd
  .command("delete <id>")
  .description("Delete a template")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--yes", "Skip confirmation")
  .action(async (id: string, opts: { project?: number; yes?: boolean }) => {
    await runHandler(async () => {
      const { handleTemplatesDelete } = await import("./cli/templates.js");
      await handleTemplatesDelete(opts.project, parseInt(id, 10), { yes: opts.yes });
    });
  });

// ── keys ──
const keysCmd = program.command("keys").description("Manage access keys");

keysCmd
  .command("list")
  .description("List keys in a project")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleKeysList } = await import("./cli/keys.js");
      await handleKeysList(opts.project, { json: opts.json ?? program.opts().json });
    });
  });

keysCmd
  .command("get <id>")
  .description("Get a key by ID")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleKeysGet } = await import("./cli/keys.js");
      await handleKeysGet(opts.project, parseInt(id, 10), { json: opts.json ?? program.opts().json });
    });
  });

keysCmd
  .command("create")
  .description("Create a key")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .requiredOption("--name <name>", "Key name")
  .requiredOption("--type <type>", "Key type (none|ssh|login_password|string). `login` is accepted as an alias of `login_password`")
  .option("--private-key <key>", "SSH private key content")
  .option("--private-key-file <path>", "Path to SSH private key file")
  .option("--login <user>", "Login username (for type login)")
  .option("--password <password>", "Login password (for type login)")
  .option("--string <value>", "Secret value (for type string)")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; name: string; type: string; privateKey?: string; privateKeyFile?: string; login?: string; password?: string; string?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleKeysCreate } = await import("./cli/keys.js");
      await handleKeysCreate(
        opts.project,
        {
          name: opts.name,
          type: opts.type as "none" | "ssh" | "login_password" | "string",
          privateKey: opts.privateKey,
          privateKeyFile: opts.privateKeyFile,
          login: opts.login,
          password: opts.password,
          string: opts.string,
        },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

keysCmd
  .command("update <id>")
  .description("Update a key")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--name <name>", "Key name")
  .option("--type <type>", "Key type (none|ssh|login_password|string). `login` is accepted as an alias of `login_password`")
  .option("--private-key <key>", "SSH private key content")
  .option("--private-key-file <path>", "Path to SSH private key file")
  .option("--login <user>", "Login username (for type login)")
  .option("--password <password>", "Login password (for type login)")
  .option("--string <value>", "Secret value (for type string)")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; name?: string; type?: string; privateKey?: string; privateKeyFile?: string; login?: string; password?: string; string?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleKeysUpdate } = await import("./cli/keys.js");
      await handleKeysUpdate(
        opts.project,
        parseInt(id, 10),
        {
          name: opts.name,
          type: opts.type,
          privateKey: opts.privateKey,
          privateKeyFile: opts.privateKeyFile,
          login: opts.login,
          password: opts.password,
          string: opts.string,
        },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

keysCmd
  .command("delete <id>")
  .description("Delete a key")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--yes", "Skip confirmation")
  .action(async (id: string, opts: { project?: number; yes?: boolean }) => {
    await runHandler(async () => {
      const { handleKeysDelete } = await import("./cli/keys.js");
      await handleKeysDelete(opts.project, parseInt(id, 10), { yes: opts.yes });
    });
  });

// ── repositories ──
const repositoriesCmd = program.command("repositories").description("Manage repositories");

repositoriesCmd
  .command("list")
  .description("List repositories in a project")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleRepositoriesList } = await import("./cli/repositories.js");
      await handleRepositoriesList(opts.project, { json: opts.json ?? program.opts().json });
    });
  });

repositoriesCmd
  .command("get <id>")
  .description("Get a repository by ID")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleRepositoriesGet } = await import("./cli/repositories.js");
      await handleRepositoriesGet(opts.project, parseInt(id, 10), { json: opts.json ?? program.opts().json });
    });
  });

repositoriesCmd
  .command("create")
  .description("Create a repository")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .requiredOption("--name <name>", "Repository name")
  .requiredOption("--git-url <url>", "Git URL")
  .requiredOption("--git-branch <branch>", "Git branch")
  .requiredOption("--ssh-key-id <id>", "SSH key ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; name: string; gitUrl: string; gitBranch: string; sshKeyId: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleRepositoriesCreate } = await import("./cli/repositories.js");
      await handleRepositoriesCreate(
        opts.project,
        { name: opts.name, gitUrl: opts.gitUrl, gitBranch: opts.gitBranch, sshKeyId: opts.sshKeyId },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

repositoriesCmd
  .command("update <id>")
  .description("Update a repository")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--name <name>", "Repository name")
  .option("--git-url <url>", "Git URL")
  .option("--git-branch <branch>", "Git branch")
  .option("--ssh-key-id <id>", "SSH key ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; name?: string; gitUrl?: string; gitBranch?: string; sshKeyId?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleRepositoriesUpdate } = await import("./cli/repositories.js");
      await handleRepositoriesUpdate(
        opts.project,
        parseInt(id, 10),
        { name: opts.name, gitUrl: opts.gitUrl, gitBranch: opts.gitBranch, sshKeyId: opts.sshKeyId },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

repositoriesCmd
  .command("branches <id>")
  .description("Branches the server can see in the repository")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleRepositoriesBranches } = await import("./cli/repositories.js");
      await handleRepositoriesBranches(opts.project, parseInt(id, 10), { json: opts.json ?? program.opts().json });
    });
  });

repositoriesCmd
  .command("playbooks <id>")
  .description("Playbooks/scripts found in the repository — what --playbook expects")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleRepositoriesPlaybooks } = await import("./cli/repositories.js");
      await handleRepositoriesPlaybooks(opts.project, parseInt(id, 10), { json: opts.json ?? program.opts().json });
    });
  });

repositoriesCmd
  .command("delete <id>")
  .description("Delete a repository")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--yes", "Skip confirmation")
  .action(async (id: string, opts: { project?: number; yes?: boolean }) => {
    await runHandler(async () => {
      const { handleRepositoriesDelete } = await import("./cli/repositories.js");
      await handleRepositoriesDelete(opts.project, parseInt(id, 10), { yes: opts.yes });
    });
  });

// ── inventory ──
const inventoryCmd = program.command("inventory").description("Manage inventory");

inventoryCmd
  .command("list")
  .description("List inventory in a project")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleInventoryList } = await import("./cli/inventory.js");
      await handleInventoryList(opts.project, { json: opts.json ?? program.opts().json });
    });
  });

inventoryCmd
  .command("get <id>")
  .description("Get an inventory by ID")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleInventoryGet } = await import("./cli/inventory.js");
      await handleInventoryGet(opts.project, parseInt(id, 10), { json: opts.json ?? program.opts().json });
    });
  });

inventoryCmd
  .command("create")
  .description("Create an inventory")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .requiredOption("--name <name>", "Inventory name")
  .option("--inventory <content>", "Inventory content")
  .option("--inventory-file <path>", "Path to inventory file")
  .requiredOption("--type <type>", "Inventory type (static|file|static-yaml|terraform-workspace|tofu-workspace|terragrunt-workspace)")
  .option("--ssh-key-id <id>", "User credentials: SSH key ID (optional: a static inventory does not need one)", parseIntOption)
  .option("--become-key-id <id>", "Sudo credentials: key used for privilege escalation", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; name: string; inventory?: string; inventoryFile?: string; type: string; sshKeyId?: number; becomeKeyId?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleInventoryCreate } = await import("./cli/inventory.js");
      await handleInventoryCreate(
        opts.project,
        {
          name: opts.name,
          inventory: opts.inventory,
          inventoryFile: opts.inventoryFile,
          type: opts.type as "static" | "file" | "static-yaml" | "terraform-workspace" | "tofu-workspace" | "terragrunt-workspace",
          ...(opts.sshKeyId !== undefined && { sshKeyId: opts.sshKeyId }),
          ...(opts.becomeKeyId !== undefined && { becomeKeyId: opts.becomeKeyId }),
        },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

inventoryCmd
  .command("update <id>")
  .description("Update an inventory")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--name <name>", "Inventory name")
  .option("--inventory <content>", "Inventory content")
  .option("--type <type>", "Inventory type (static|file|static-yaml|terraform-workspace|tofu-workspace|terragrunt-workspace)")
  .option("--ssh-key-id <id>", "User credentials: SSH key ID", parseIntOption)
  .option("--become-key-id <id>", "Sudo credentials: key used for privilege escalation", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; name?: string; inventory?: string; type?: string; sshKeyId?: number; becomeKeyId?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleInventoryUpdate } = await import("./cli/inventory.js");
      await handleInventoryUpdate(
        opts.project,
        parseInt(id, 10),
        {
          name: opts.name,
          inventory: opts.inventory,
          type: opts.type as ("static" | "file" | "static-yaml" | "terraform-workspace" | "tofu-workspace" | "terragrunt-workspace") | undefined,
          sshKeyId: opts.sshKeyId,
          becomeKeyId: opts.becomeKeyId,
        },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

inventoryCmd
  .command("delete <id>")
  .description("Delete an inventory")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--yes", "Skip confirmation")
  .action(async (id: string, opts: { project?: number; yes?: boolean }) => {
    await runHandler(async () => {
      const { handleInventoryDelete } = await import("./cli/inventory.js");
      await handleInventoryDelete(opts.project, parseInt(id, 10), { yes: opts.yes });
    });
  });

// ── environment ──
const environmentCmd = program.command("environment").description("Manage environment variable groups");

environmentCmd
  .command("list")
  .description("List environment groups in a project")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleEnvironmentList } = await import("./cli/environment.js");
      await handleEnvironmentList(opts.project, { json: opts.json ?? program.opts().json });
    });
  });

environmentCmd
  .command("get <id>")
  .description("Get an environment group by ID")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleEnvironmentGet } = await import("./cli/environment.js");
      await handleEnvironmentGet(opts.project, parseInt(id, 10), { json: opts.json ?? program.opts().json });
    });
  });

environmentCmd
  .command("create")
  .description("Create an environment group")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .requiredOption("--name <name>", "Environment name")
  .option("--password <password>", "Vault password")
  .option("--var <kv...>", "Environment variable KEY=VALUE (repeatable)")
  .option("--extra-var <kv...>", "Extra variable KEY=VALUE, the ansible --extra-vars side (repeatable)")
  .option("--secret-var <kv...>", "SECRET extra variable KEY=VALUE (repeatable)")
  .option("--secret-env <kv...>", "SECRET environment variable KEY=VALUE (repeatable)")
  .option("--from-env <path>", "Load environment variables from .env file")
  .option("--secret", "Deprecated: puts --var/--from-env in the extra variables field. Nothing is encrypted; use --secret-var/--secret-env for real secrets")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; name: string; password?: string; var?: string[]; extraVar?: string[]; secretVar?: string[]; secretEnv?: string[]; fromEnv?: string; secret?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleEnvironmentCreate } = await import("./cli/environment.js");
      await handleEnvironmentCreate(
        opts.project,
        {
          name: opts.name,
          password: opts.password,
          vars: opts.var,
          extraVars: opts.extraVar,
          secretVars: opts.secretVar,
          secretEnvs: opts.secretEnv,
          fromEnv: opts.fromEnv,
          secret: opts.secret,
        },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

environmentCmd
  .command("update <id>")
  .description("Update an environment group")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--name <name>", "Environment name")
  .option("--password <password>", "Vault password")
  .option("--var <kv...>", "Replace the environment variables with these KEY=VALUE (repeatable)")
  .option("--extra-var <kv...>", "Replace the extra variables with these KEY=VALUE (repeatable)")
  .option("--secret-var <kv...>", "Add a SECRET extra variable KEY=VALUE (repeatable)")
  .option("--secret-env <kv...>", "Add a SECRET environment variable KEY=VALUE (repeatable)")
  .option("--delete-secret <name...>", "Delete a secret by name; fails if the name exists in both types (repeatable)")
  .option("--delete-secret-var <name...>", "Delete a SECRET extra variable by name (repeatable)")
  .option("--delete-secret-env <name...>", "Delete a SECRET environment variable by name (repeatable)")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; name?: string; password?: string; var?: string[]; extraVar?: string[]; secretVar?: string[]; secretEnv?: string[]; deleteSecret?: string[]; deleteSecretVar?: string[]; deleteSecretEnv?: string[]; json?: boolean }) => {
    await runHandler(async () => {
      const { handleEnvironmentUpdate } = await import("./cli/environment.js");
      await handleEnvironmentUpdate(
        opts.project,
        parseInt(id, 10),
        {
          name: opts.name,
          password: opts.password,
          vars: opts.var,
          extraVars: opts.extraVar,
          secretVars: opts.secretVar,
          secretEnvs: opts.secretEnv,
          deleteSecrets: opts.deleteSecret,
          deleteSecretVars: opts.deleteSecretVar,
          deleteSecretEnvs: opts.deleteSecretEnv,
        },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

environmentCmd
  .command("delete <id>")
  .description("Delete an environment group")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--yes", "Skip confirmation")
  .action(async (id: string, opts: { project?: number; yes?: boolean }) => {
    await runHandler(async () => {
      const { handleEnvironmentDelete } = await import("./cli/environment.js");
      await handleEnvironmentDelete(opts.project, parseInt(id, 10), { yes: opts.yes });
    });
  });

// ── schedules ──
const schedulesCmd = program.command("schedules").description("Manage schedules");

schedulesCmd
  .command("list")
  .description("List schedules in a project")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleSchedulesList } = await import("./cli/schedules.js");
      await handleSchedulesList(opts.project, { json: opts.json ?? program.opts().json });
    });
  });

schedulesCmd
  .command("get <id>")
  .description("Get a schedule by ID")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleSchedulesGet } = await import("./cli/schedules.js");
      await handleSchedulesGet(opts.project, parseInt(id, 10), { json: opts.json ?? program.opts().json });
    });
  });

schedulesCmd
  .command("create")
  .description("Create a schedule")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .requiredOption("--template-id <id>", "Template ID", parseIntOption)
  .option("--cron <format>", "Cron format (e.g. '0 2 * * *'). Mutually exclusive with --run-at")
  .option("--run-at <iso>", "Run once at this ISO timestamp, which must be in the future")
  .option("--delete-after-run", "Delete the schedule once it has run")
  .option("--name <name>", "Schedule name")
  .option("--no-enabled", "Create it paused (by default it is created active)")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; templateId: number; cron?: string; runAt?: string; deleteAfterRun?: boolean; name?: string; enabled?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleSchedulesCreate } = await import("./cli/schedules.js");
      await handleSchedulesCreate(
        opts.project,
        {
          templateId: opts.templateId,
          cronFormat: opts.cron,
          runAt: opts.runAt,
          deleteAfterRun: opts.deleteAfterRun,
          name: opts.name,
          enabled: opts.enabled,
        },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

schedulesCmd
  .command("update <id>")
  .description("Update a schedule")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--template-id <id>", "Template ID", parseIntOption)
  .option("--cron <format>", "Cron format (e.g. '0 2 * * *')")
  .option("--run-at <iso>", "Run once at this ISO timestamp (turns it into a run_at schedule)")
  .option("--name <name>", "Schedule name")
  .option("--enabled", "Activate the schedule")
  .option("--no-enabled", "Pause the schedule without deleting it")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; templateId?: number; cron?: string; runAt?: string; name?: string; enabled?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleSchedulesUpdate } = await import("./cli/schedules.js");
      await handleSchedulesUpdate(
        opts.project,
        parseInt(id, 10),
        { templateId: opts.templateId, cronFormat: opts.cron, runAt: opts.runAt, name: opts.name, enabled: opts.enabled },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

schedulesCmd
  .command("delete <id>")
  .description("Delete a schedule")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--yes", "Skip confirmation")
  .action(async (id: string, opts: { project?: number; yes?: boolean }) => {
    await runHandler(async () => {
      const { handleSchedulesDelete } = await import("./cli/schedules.js");
      await handleSchedulesDelete(opts.project, parseInt(id, 10), { yes: opts.yes });
    });
  });


// ── views ──
const viewsCmd = program.command("views").description("Manage views (the template tabs of the UI)");

viewsCmd
  .command("list")
  .description("List views in a project")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleViewsList } = await import("./cli/views.js");
      await handleViewsList(opts.project, { json: opts.json ?? program.opts().json });
    });
  });

viewsCmd
  .command("get <id>")
  .description("Get a view by ID")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleViewsGet } = await import("./cli/views.js");
      await handleViewsGet(opts.project, parseInt(id, 10), { json: opts.json ?? program.opts().json });
    });
  });

viewsCmd
  .command("create")
  .description("Create a view")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .requiredOption("--title <title>", "View title")
  .option("--position <n>", "Position among the tabs", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; title: string; position?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleViewsCreate } = await import("./cli/views.js");
      await handleViewsCreate(
        opts.project,
        { title: opts.title, position: opts.position },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

viewsCmd
  .command("update <id>")
  .description("Update a view")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--title <title>", "View title")
  .option("--position <n>", "Position among the tabs", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; title?: string; position?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleViewsUpdate } = await import("./cli/views.js");
      await handleViewsUpdate(
        opts.project,
        parseInt(id, 10),
        { title: opts.title, position: opts.position },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

viewsCmd
  .command("delete <id>")
  .description("Delete a view")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--yes", "Skip confirmation")
  .action(async (id: string, opts: { project?: number; yes?: boolean }) => {
    await runHandler(async () => {
      const { handleViewsDelete } = await import("./cli/views.js");
      await handleViewsDelete(opts.project, parseInt(id, 10), { yes: opts.yes });
    });
  });

// ── users ──
const usersCmd = program.command("users").description("Manage users");

usersCmd
  .command("list")
  .description("List all users")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    await runHandler(async () => {
      const { handleUsersList } = await import("./cli/users.js");
      await handleUsersList({ json: opts.json ?? program.opts().json });
    });
  });

usersCmd
  .command("get <id>")
  .description("Get a user by ID")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { json?: boolean }) => {
    await runHandler(async () => {
      const { handleUsersGet } = await import("./cli/users.js");
      await handleUsersGet(parseInt(id, 10), { json: opts.json ?? program.opts().json });
    });
  });

// ── workflows ──
// Requires Semaphore >= 2.19. On older servers these endpoints do not exist.
const workflowsCmd = program.command("workflows").description("Manage workflows (Semaphore >= 2.19)");

workflowsCmd
  .command("list")
  .description("List workflows in a project")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkflowsList } = await import("./cli/workflows.js");
      await handleWorkflowsList(opts.project, { json: opts.json ?? program.opts().json });
    });
  });

workflowsCmd
  .command("get <id>")
  .description("Get a workflow by ID (includes its nodes and edges)")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkflowsGet } = await import("./cli/workflows.js");
      await handleWorkflowsGet(opts.project, parseInt(id, 10), { json: opts.json ?? program.opts().json });
    });
  });

workflowsCmd
  .command("create")
  .description("Create a workflow from a JSON graph file")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .requiredOption("--file <path>", "JSON file with { name, nodes[], edges[] }")
  .option("--name <name>", "Override the name in the file")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; file: string; name?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkflowsCreate } = await import("./cli/workflows.js");
      await handleWorkflowsCreate(opts.project, { file: opts.file, ...(opts.name !== undefined && { name: opts.name }), json: opts.json ?? program.opts().json });
    });
  });

workflowsCmd
  .command("update <id>")
  .description("Update a workflow (partial: what you omit is kept)")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--file <path>", "JSON file with the new graph")
  .option("--name <name>", "New name")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; file?: string; name?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkflowsUpdate } = await import("./cli/workflows.js");
      await handleWorkflowsUpdate(
        opts.project,
        parseInt(id, 10),
        {
          ...(opts.file !== undefined && { file: opts.file }),
          ...(opts.name !== undefined && { name: opts.name }),
          json: opts.json ?? program.opts().json,
        },
      );
    });
  });

workflowsCmd
  .command("delete <id>")
  .description("Delete a workflow")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("-y, --yes", "Skip confirmation")
  .action(async (id: string, opts: { project?: number; yes?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkflowsDelete } = await import("./cli/workflows.js");
      await handleWorkflowsDelete(opts.project, parseInt(id, 10), { yes: opts.yes });
    });
  });

workflowsCmd
  .command("run <id>")
  .description("Start a workflow run")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkflowsRun } = await import("./cli/workflows.js");
      await handleWorkflowsRun(opts.project, parseInt(id, 10), { json: opts.json ?? program.opts().json });
    });
  });

workflowsCmd
  .command("runs <id>")
  .description("List runs of a workflow")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkflowsRuns } = await import("./cli/workflows.js");
      await handleWorkflowsRuns(opts.project, parseInt(id, 10), { json: opts.json ?? program.opts().json });
    });
  });

workflowsCmd
  .command("stop <id> <runId>")
  .description("Stop a running workflow run")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .action(async (id: string, runId: string, opts: { project?: number }) => {
    await runHandler(async () => {
      const { handleWorkflowsStop } = await import("./cli/workflows.js");
      await handleWorkflowsStop(opts.project, parseInt(id, 10), parseInt(runId, 10), {});
    });
  });

workflowsCmd
  .command("approvals <id> <runId>")
  .description("List approval gates of a run")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (id: string, runId: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkflowsApprovals } = await import("./cli/workflows.js");
      await handleWorkflowsApprovals(opts.project, parseInt(id, 10), parseInt(runId, 10), { json: opts.json ?? program.opts().json });
    });
  });

workflowsCmd
  .command("approve <id> <runId> <nodeId>")
  .description("Approve a pending approval gate")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .action(async (id: string, runId: string, nodeId: string, opts: { project?: number }) => {
    await runHandler(async () => {
      const { handleWorkflowsApprove } = await import("./cli/workflows.js");
      await handleWorkflowsApprove(opts.project, parseInt(id, 10), parseInt(runId, 10), parseInt(nodeId, 10), true, {});
    });
  });

workflowsCmd
  .command("reject <id> <runId> <nodeId>")
  .description("Reject a pending approval gate")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .action(async (id: string, runId: string, nodeId: string, opts: { project?: number }) => {
    await runHandler(async () => {
      const { handleWorkflowsApprove } = await import("./cli/workflows.js");
      await handleWorkflowsApprove(opts.project, parseInt(id, 10), parseInt(runId, 10), parseInt(nodeId, 10), false, {});
    });
  });

// ── integrations ──
const integrationsCmd = program
  .command("integrations")
  .description("Manage webhook integrations, their matchers, extract values and aliases");

integrationsCmd
  .command("list")
  .description("List integrations in a project")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleIntegrationsList } = await import("./cli/integrations.js");
      await handleIntegrationsList(opts.project, { json: opts.json ?? program.opts().json });
    });
  });

integrationsCmd
  .command("get <id>")
  .description("Get an integration by ID")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleIntegrationsGet } = await import("./cli/integrations.js");
      await handleIntegrationsGet(opts.project, parseInt(id, 10), { json: opts.json ?? program.opts().json });
    });
  });

integrationsCmd
  .command("create")
  .description("Create an integration")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .requiredOption("--name <name>", "Integration name")
  .requiredOption("--template-id <id>", "Template the webhook runs", parseIntOption)
  .option("--auth-method <method>", "none|github|bitbucket|hmac|token|basic (default: none, an open endpoint)")
  .option("--auth-secret-id <id>", "Key holding the shared secret", parseIntOption)
  .option("--auth-header <header>", "Header carrying the token or signature (token, hmac)")
  .option("--searchable", "Reach it through the project alias and its matchers, not its own alias")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; name: string; templateId: number; authMethod?: string; authSecretId?: number; authHeader?: string; searchable?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleIntegrationsCreate } = await import("./cli/integrations.js");
      await handleIntegrationsCreate(
        opts.project,
        {
          name: opts.name,
          templateId: opts.templateId,
          authMethod: parseAuthMethod(opts.authMethod),
          authSecretId: opts.authSecretId,
          authHeader: opts.authHeader,
          searchable: opts.searchable,
        },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

integrationsCmd
  .command("update <id>")
  .description("Update an integration")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--name <name>", "Integration name")
  .option("--template-id <id>", "Template the webhook runs", parseIntOption)
  .option("--auth-method <method>", "none|github|bitbucket|hmac|token|basic")
  .option("--auth-secret-id <id>", "Key holding the shared secret", parseIntOption)
  .option("--auth-header <header>", "Header carrying the token or signature")
  // The positive flag MUST stay declared before the negated one. Measured on
  // commander 14.0.3: declared this way, passing neither leaves `searchable`
  // absent, which is what keeps the merge from touching it. Swap the two lines
  // and commander applies the `--no-` default, so every `integrations update`
  // would silently set `searchable: true` — killing the integration's own alias.
  .option("--searchable", "Reach it through the project alias and its matchers")
  .option("--no-searchable", "Reach it through its own alias, ignoring its matchers")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; name?: string; templateId?: number; authMethod?: string; authSecretId?: number; authHeader?: string; searchable?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleIntegrationsUpdate } = await import("./cli/integrations.js");
      await handleIntegrationsUpdate(
        opts.project,
        parseInt(id, 10),
        {
          name: opts.name,
          templateId: opts.templateId,
          authMethod: parseAuthMethod(opts.authMethod),
          authSecretId: opts.authSecretId,
          authHeader: opts.authHeader,
          searchable: opts.searchable,
        },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

integrationsCmd
  .command("delete <id>")
  .description("Delete an integration")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--yes", "Skip confirmation")
  .action(async (id: string, opts: { project?: number; yes?: boolean }) => {
    await runHandler(async () => {
      const { handleIntegrationsDelete } = await import("./cli/integrations.js");
      await handleIntegrationsDelete(opts.project, parseInt(id, 10), { yes: opts.yes });
    });
  });

// ── integrations matchers ──
const matchersCmd = integrationsCmd
  .command("matchers")
  .description("Conditions an incoming request must meet to fire an integration");

matchersCmd
  .command("list <integrationId>")
  .description("List the matchers of an integration")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (integrationId: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleMatchersList } = await import("./cli/integrations.js");
      await handleMatchersList(opts.project, parseInt(integrationId, 10), { json: opts.json ?? program.opts().json });
    });
  });

matchersCmd
  .command("get <integrationId> <matcherId>")
  .description("Get a matcher by ID")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (integrationId: string, matcherId: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleMatchersGet } = await import("./cli/integrations.js");
      await handleMatchersGet(opts.project, parseInt(integrationId, 10), parseInt(matcherId, 10), { json: opts.json ?? program.opts().json });
    });
  });

matchersCmd
  .command("create <integrationId>")
  .description("Add a matcher to an integration")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .requiredOption("--name <name>", "Matcher name")
  .requiredOption("--match-type <type>", "header|body")
  .requiredOption("--method <method>", "equals|unequals|contains")
  .requiredOption("--key <key>", "Header name, or JSON path inside the body")
  .requiredOption("--value <value>", "Value to compare against")
  .option("--body-data-type <type>", "json|string, when --match-type is body (default: json)")
  .option("--json", "Output as JSON")
  .action(async (integrationId: string, opts: { project?: number; name: string; matchType: string; method: string; key: string; value: string; bodyDataType?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleMatchersCreate } = await import("./cli/integrations.js");
      await handleMatchersCreate(
        opts.project,
        parseInt(integrationId, 10),
        {
          name: opts.name,
          matchType: parseMatchType(opts.matchType),
          method: parseMatchMethod(opts.method),
          key: opts.key,
          value: opts.value,
          bodyDataType: parseBodyDataType(opts.bodyDataType),
        },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

matchersCmd
  .command("update <integrationId> <matcherId>")
  .description("Update a matcher")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--name <name>", "Matcher name")
  .option("--match-type <type>", "header|body")
  .option("--method <method>", "equals|unequals|contains")
  .option("--key <key>", "Header name, or JSON path inside the body")
  .option("--value <value>", "Value to compare against")
  .option("--body-data-type <type>", "json|string")
  .option("--json", "Output as JSON")
  .action(async (integrationId: string, matcherId: string, opts: { project?: number; name?: string; matchType?: string; method?: string; key?: string; value?: string; bodyDataType?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleMatchersUpdate } = await import("./cli/integrations.js");
      await handleMatchersUpdate(
        opts.project,
        parseInt(integrationId, 10),
        parseInt(matcherId, 10),
        {
          name: opts.name,
          matchType: parseMatchType(opts.matchType),
          method: parseMatchMethod(opts.method),
          key: opts.key,
          value: opts.value,
          bodyDataType: parseBodyDataType(opts.bodyDataType),
        },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

matchersCmd
  .command("delete <integrationId> <matcherId>")
  .description("Delete a matcher")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--yes", "Skip confirmation")
  .action(async (integrationId: string, matcherId: string, opts: { project?: number; yes?: boolean }) => {
    await runHandler(async () => {
      const { handleMatchersDelete } = await import("./cli/integrations.js");
      await handleMatchersDelete(opts.project, parseInt(integrationId, 10), parseInt(matcherId, 10), { yes: opts.yes });
    });
  });

matchersCmd
  .command("refs <integrationId> <matcherId>")
  .description("Show which integration a matcher belongs to")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (integrationId: string, matcherId: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleMatchersRefs } = await import("./cli/integrations.js");
      await handleMatchersRefs(opts.project, parseInt(integrationId, 10), parseInt(matcherId, 10), { json: opts.json ?? program.opts().json });
    });
  });

// ── integrations values ──
const valuesCmd = integrationsCmd
  .command("values")
  .description("Parts of the request an integration turns into task variables");

valuesCmd
  .command("list <integrationId>")
  .description("List the extract values of an integration")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (integrationId: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleValuesList } = await import("./cli/integrations.js");
      await handleValuesList(opts.project, parseInt(integrationId, 10), { json: opts.json ?? program.opts().json });
    });
  });

valuesCmd
  .command("get <integrationId> <valueId>")
  .description("Get an extract value by ID")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (integrationId: string, valueId: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleValuesGet } = await import("./cli/integrations.js");
      await handleValuesGet(opts.project, parseInt(integrationId, 10), parseInt(valueId, 10), { json: opts.json ?? program.opts().json });
    });
  });

valuesCmd
  .command("create <integrationId>")
  .description("Add an extract value to an integration")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .requiredOption("--name <name>", "Extract value name")
  .requiredOption("--value-source <source>", "body|header")
  .requiredOption("--variable <variable>", "Name the value gets inside the task")
  .option("--variable-type <type>", "environment|task (default: environment)")
  .option("--key <key>", "Header name, or JSON path inside the body")
  .option("--body-data-type <type>", "json|string, when --value-source is body (default: json)")
  .option("--json", "Output as JSON")
  .action(async (integrationId: string, opts: { project?: number; name: string; valueSource: string; variable: string; variableType?: string; key?: string; bodyDataType?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleValuesCreate } = await import("./cli/integrations.js");
      await handleValuesCreate(
        opts.project,
        parseInt(integrationId, 10),
        {
          name: opts.name,
          valueSource: parseValueSource(opts.valueSource),
          variable: opts.variable,
          variableType: parseVariableType(opts.variableType) ?? "environment",
          key: opts.key,
          bodyDataType: parseBodyDataType(opts.bodyDataType),
        },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

valuesCmd
  .command("update <integrationId> <valueId>")
  .description("Update an extract value")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--name <name>", "Extract value name")
  .option("--value-source <source>", "body|header")
  .option("--variable <variable>", "Name the value gets inside the task")
  .option("--variable-type <type>", "environment|task")
  .option("--key <key>", "Header name, or JSON path inside the body")
  .option("--body-data-type <type>", "json|string")
  .option("--json", "Output as JSON")
  .action(async (integrationId: string, valueId: string, opts: { project?: number; name?: string; valueSource?: string; variable?: string; variableType?: string; key?: string; bodyDataType?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleValuesUpdate } = await import("./cli/integrations.js");
      await handleValuesUpdate(
        opts.project,
        parseInt(integrationId, 10),
        parseInt(valueId, 10),
        {
          name: opts.name,
          valueSource: parseValueSource(opts.valueSource),
          variable: opts.variable,
          variableType: parseVariableType(opts.variableType),
          key: opts.key,
          bodyDataType: parseBodyDataType(opts.bodyDataType),
        },
        { json: opts.json ?? program.opts().json },
      );
    });
  });

valuesCmd
  .command("delete <integrationId> <valueId>")
  .description("Delete an extract value")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--yes", "Skip confirmation")
  .action(async (integrationId: string, valueId: string, opts: { project?: number; yes?: boolean }) => {
    await runHandler(async () => {
      const { handleValuesDelete } = await import("./cli/integrations.js");
      await handleValuesDelete(opts.project, parseInt(integrationId, 10), parseInt(valueId, 10), { yes: opts.yes });
    });
  });

valuesCmd
  .command("refs <integrationId> <valueId>")
  .description("Show which integration an extract value belongs to")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (integrationId: string, valueId: string, opts: { project?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleValuesRefs } = await import("./cli/integrations.js");
      await handleValuesRefs(opts.project, parseInt(integrationId, 10), parseInt(valueId, 10), { json: opts.json ?? program.opts().json });
    });
  });

// ── integrations aliases ──
const aliasesCmd = integrationsCmd
  .command("aliases")
  .description("Public URLs that fire an integration (--integration for one, none for the project)");

aliasesCmd
  .command("list")
  .description("List aliases of an integration, or of the whole project")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--integration <id>", "Integration ID; omit for the project-wide aliases", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; integration?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleAliasesList } = await import("./cli/integrations.js");
      await handleAliasesList(opts.project, opts.integration, { json: opts.json ?? program.opts().json });
    });
  });

aliasesCmd
  .command("create")
  .description("Create an alias; the server generates the random string, it cannot be chosen")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--integration <id>", "Integration ID; omit for a project-wide alias", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; integration?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleAliasesCreate } = await import("./cli/integrations.js");
      await handleAliasesCreate(opts.project, opts.integration, { json: opts.json ?? program.opts().json });
    });
  });

aliasesCmd
  .command("delete <aliasId>")
  .description("Delete an alias")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--integration <id>", "Integration ID; the alias is found by project either way", parseIntOption)
  .option("--yes", "Skip confirmation")
  .action(async (aliasId: string, opts: { project?: number; integration?: number; yes?: boolean }) => {
    await runHandler(async () => {
      const { handleAliasesDelete } = await import("./cli/integrations.js");
      await handleAliasesDelete(opts.project, parseInt(aliasId, 10), opts.integration, { yes: opts.yes });
    });
  });

// ── backup ──
const backupCmd = program.command("backup").description("Export and restore whole projects");

backupCmd
  .command("export")
  .description("Export a project as JSON (Semaphore has no config-as-code: this is the closest thing)")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--file <path>", "Write to file instead of stdout (created with mode 600)")
  .action(async (opts: { project?: number; file?: string }) => {
    await runHandler(async () => {
      const { handleBackupExport } = await import("./cli/backup.js");
      await handleBackupExport(opts.project, { file: opts.file });
    });
  });

backupCmd
  .command("restore")
  .description("Restore a backup as a NEW project (never overwrites an existing one)")
  .requiredOption("--file <path>", "Backup JSON file")
  .action(async (opts: { file: string }) => {
    await runHandler(async () => {
      const { handleBackupRestore } = await import("./cli/backup.js");
      await handleBackupRestore({ file: opts.file });
    });
  });

await program.parseAsync(process.argv);
