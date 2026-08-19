#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { runHandler } from "./cli/shared.js";

const parseIntOption = (v: string): number => parseInt(v, 10);

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string };

const program = new Command();

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
  smphe login --token YOUR_API_TOKEN
  smphe use <projectId>

Quick start:
  smphe templates list --json          # find template IDs
  smphe tasks run <templateId>         # run a playbook
  smphe tasks get <taskId> --json      # poll status
  smphe tasks output <taskId>          # view output

Project context (priority order):
  --project <id>     flag on any command
  SMPHE_PROJECT=<id> environment variable
  smphe use <id>     saved in config

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
  .requiredOption("--token <token>", "API token")
  .action(async (opts: { token: string }) => {
    await runHandler(async () => {
      const { handleLoginToken } = await import("./cli/config-command.js");
      await handleLoginToken(opts.token);
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
      await handleProjectsList(opts);
    });
  });

projectsCmd
  .command("get <id>")
  .description("Get a project by ID")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { json?: boolean }) => {
    await runHandler(async () => {
      const { handleProjectsGet } = await import("./cli/projects.js");
      await handleProjectsGet(parseInt(id, 10), opts);
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
        { json: opts.json },
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
        { json: opts.json },
      );
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

// ── tasks ──
const tasksCmd = program.command("tasks").description("Manage tasks");

tasksCmd
  .command("list")
  .description("List tasks in a project")
  .option("-p, --project <id>", "Project ID", parseIntOption)
  .option("--status <status>", "Filter by status (waiting|running|stopped|error|success)")
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
  .action(async (taskId: string, opts: { project?: number }) => {
    await runHandler(async () => {
      const { handleTasksStop } = await import("./cli/tasks.js");
      await handleTasksStop(opts.project, parseInt(taskId, 10), {});
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
  .requiredOption("--inventory-id <id>", "Inventory ID", parseIntOption)
  .requiredOption("--repository-id <id>", "Repository ID", parseIntOption)
  .requiredOption("--environment-id <id>", "Environment ID", parseIntOption)
  .requiredOption("--playbook <file>", "Playbook file")
  .option("--app <app>", "App type (ansible|terraform|tofu|bash|python|powershell)")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; name: string; inventoryId: number; repositoryId: number; environmentId: number; playbook: string; app?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleTemplatesCreate } = await import("./cli/templates.js");
      await handleTemplatesCreate(
        opts.project,
        {
          name: opts.name,
          inventoryId: opts.inventoryId,
          repositoryId: opts.repositoryId,
          environmentId: opts.environmentId,
          playbook: opts.playbook,
          app: opts.app as "ansible" | "terraform" | "tofu" | "bash" | "python" | "powershell" | undefined,
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
  .option("--environment-id <id>", "Environment ID", parseIntOption)
  .option("--playbook <file>", "Playbook file")
  .option("--app <app>", "App type")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; name?: string; inventoryId?: number; repositoryId?: number; environmentId?: number; playbook?: string; app?: string; json?: boolean }) => {
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
          playbook: opts.playbook,
          app: opts.app as "ansible" | "terraform" | "tofu" | "bash" | "python" | "powershell" | undefined,
        },
        { json: opts.json ?? program.opts().json },
      );
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
  .requiredOption("--type <type>", "Key type (none|ssh|login)")
  .option("--private-key <key>", "SSH private key content")
  .option("--private-key-file <path>", "Path to SSH private key file")
  .option("--login <user>", "Login username (for type login)")
  .option("--password <password>", "Login password (for type login)")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; name: string; type: string; privateKey?: string; privateKeyFile?: string; login?: string; password?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleKeysCreate } = await import("./cli/keys.js");
      await handleKeysCreate(
        opts.project,
        {
          name: opts.name,
          type: opts.type as "none" | "ssh" | "login",
          privateKey: opts.privateKey,
          privateKeyFile: opts.privateKeyFile,
          login: opts.login,
          password: opts.password,
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
  .option("--type <type>", "Key type (none|ssh|login)")
  .option("--private-key <key>", "SSH private key content")
  .option("--private-key-file <path>", "Path to SSH private key file")
  .option("--login <user>", "Login username (for type login)")
  .option("--password <password>", "Login password (for type login)")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; name?: string; type?: string; privateKey?: string; privateKeyFile?: string; login?: string; password?: string; json?: boolean }) => {
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
  .requiredOption("--type <type>", "Inventory type (static|file|static-yaml)")
  .option("--ssh-key-id <id>", "SSH key ID (optional: a static inventory does not need one)", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; name: string; inventory?: string; inventoryFile?: string; type: string; sshKeyId: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleInventoryCreate } = await import("./cli/inventory.js");
      await handleInventoryCreate(
        opts.project,
        { name: opts.name, inventory: opts.inventory, inventoryFile: opts.inventoryFile, type: opts.type as "static" | "file" | "static-yaml", ...(opts.sshKeyId !== undefined && { sshKeyId: opts.sshKeyId }) },
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
  .option("--type <type>", "Inventory type")
  .option("--ssh-key-id <id>", "SSH key ID", parseIntOption)
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; name?: string; inventory?: string; type?: string; sshKeyId?: number; json?: boolean }) => {
    await runHandler(async () => {
      const { handleInventoryUpdate } = await import("./cli/inventory.js");
      await handleInventoryUpdate(
        opts.project,
        parseInt(id, 10),
        { name: opts.name, inventory: opts.inventory, type: opts.type as "static" | "file" | "static-yaml" | undefined, sshKeyId: opts.sshKeyId },
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
  .option("--var <kv...>", "Variable KEY=VALUE (repeatable)")
  .option("--from-env <path>", "Load variables from .env file")
  .option("--secret", "Send variables encrypted (json field instead of env)")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; name: string; password?: string; var?: string[]; fromEnv?: string; secret?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleEnvironmentCreate } = await import("./cli/environment.js");
      await handleEnvironmentCreate(
        opts.project,
        { name: opts.name, password: opts.password, vars: opts.var, fromEnv: opts.fromEnv, secret: opts.secret },
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
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; name?: string; password?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleEnvironmentUpdate } = await import("./cli/environment.js");
      await handleEnvironmentUpdate(
        opts.project,
        parseInt(id, 10),
        { name: opts.name, password: opts.password },
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
  .requiredOption("--cron <format>", "Cron format (e.g. '0 2 * * *')")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: number; templateId: number; cron: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleSchedulesCreate } = await import("./cli/schedules.js");
      await handleSchedulesCreate(
        opts.project,
        { templateId: opts.templateId, cronFormat: opts.cron },
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
  .option("--enabled", "Activate the schedule")
  .option("--no-enabled", "Pause the schedule without deleting it")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: number; templateId?: number; cron?: string; enabled?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleSchedulesUpdate } = await import("./cli/schedules.js");
      await handleSchedulesUpdate(
        opts.project,
        parseInt(id, 10),
        { templateId: opts.templateId, cronFormat: opts.cron, enabled: opts.enabled },
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
  .action(async (id: string, opts: { project?: number; file?: string; name?: string }) => {
    await runHandler(async () => {
      const { handleWorkflowsUpdate } = await import("./cli/workflows.js");
      await handleWorkflowsUpdate(opts.project, parseInt(id, 10), { ...(opts.file !== undefined && { file: opts.file }), ...(opts.name !== undefined && { name: opts.name }) });
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
