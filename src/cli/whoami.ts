import { describePermissions, ROLE_PERMISSIONS } from "../permissions.js";
import type { ProjectUserRole } from "../types.js";
import { loadConfig, type Config } from "./config.js";
import { buildClient, formatOutput, resolveProject, type HandlerDeps } from "./shared.js";

interface WhoamiResult {
  host?: string;
  username?: string;
  name?: string;
  admin?: boolean;
  can_create_project?: boolean;
  project?: number;
  /** False when a global admin operates on a project it does not belong to. */
  member?: boolean;
  role?: ProjectUserRole;
  permissions?: string[];
  can?: string[];
  cannot?: string[];
}

/** What each permission lets you do, in CLI terms. */
const CAPABILITIES: { permission: number; text: string }[] = [
  { permission: ROLE_PERMISSIONS.task_runner, text: "run tasks (smphe tasks run/stop)" },
  { permission: 4, text: "create/update project resources (templates, keys, repos, inventory, environment, schedules, views, workflows)" },
  { permission: 2, text: "update/delete the project itself" },
  { permission: 8, text: "manage project members" },
];

export async function handleWhoami(
  projectFlag: number | undefined,
  opts: { json?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  const config: Config = deps?.config ?? loadConfig({ homeDir: deps?.homeDir });
  const client = deps?.client ?? buildClient(config);

  const result: WhoamiResult = {};
  if (config.host) result.host = config.host;

  const me = await client.users.me();
  result.username = me.username;
  result.name = me.name;
  result.admin = me.admin;
  // A global admin always may; older servers omit the field entirely.
  result.can_create_project = me.can_create_project ?? me.admin ?? false;

  // An explicit --project must still fail loudly if it is invalid; only the
  // "no project selected anywhere" case is tolerated here.
  let projectId: number | undefined;
  if (projectFlag !== undefined) {
    projectId = resolveProject({ flag: projectFlag });
  } else {
    try {
      projectId = resolveProject({ env: process.env["SMPHE_PROJECT"], config });
    } catch {
      projectId = undefined;
    }
  }

  if (projectId !== undefined) {
    const role = await client.projects.getRole(projectId);
    result.project = projectId;
    // A global admin that is not a member gets role "" / permissions 0, yet the
    // server lets it through anyway: report what it can actually do.
    if (role && String(role.role) === "" && me.admin) {
      result.role = undefined;
      result.member = false;
      result.permissions = [];
      result.can = CAPABILITIES.map((c) => c.text);
      result.cannot = [];
    } else if (role) {
      result.member = true;
      result.role = role.role;
      result.permissions = describePermissions(role.permissions);
      // Global admins bypass the per-project check (GetMustCanMiddleware).
      const effective = me.admin ? ROLE_PERMISSIONS.owner : role.permissions;
      result.can = CAPABILITIES.filter((c) => (effective & c.permission) === c.permission).map((c) => c.text);
      result.cannot = CAPABILITIES.filter((c) => (effective & c.permission) !== c.permission).map((c) => c.text);
    }
  }

  if (opts.json) {
    formatOutput(result, opts);
    return;
  }

  console.log(`host:      ${result.host ?? "(not configured)"}`);
  console.log(`user:      ${result.username} (${result.name})`);
  console.log(`admin:     ${result.admin ? "yes" : "no"}`);
  console.log(`projects:  ${result.can_create_project ? "can create" : "cannot create"}`);
  if (result.project === undefined) {
    console.log("project:   (none selected — use --project or `smphe project use <id>`)");
    return;
  }
  console.log(`project:   ${result.project}`);
  if (result.member === false) {
    console.log("role:      (not a member — global admin, allowed anyway)");
  } else {
    console.log(`role:      ${result.role ?? "(unknown: server has no /role endpoint)"}`);
  }
  if (result.member === undefined) return;
  console.log(`perms:     ${result.permissions?.join(", ") || (result.member === false ? "all (global admin)" : "none")}`);
  if ((result.can ?? []).length > 0) {
    console.log("can:");
    for (const c of result.can ?? []) console.log(`  + ${c}`);
  }
  if ((result.cannot ?? []).length > 0) {
    console.log("cannot:");
    for (const c of result.cannot ?? []) console.log(`  - ${c}`);
  }
  console.log("Reads are always allowed regardless of role.");
}
