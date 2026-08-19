import type { ProjectUserRole } from "./types.js";

/**
 * Project permission bitmask, as defined by Semaphore in `db/ProjectUser.go`.
 *
 * A token inherits the permissions of the user that created it, so a token of a
 * `task_runner` can run tasks but cannot create templates or any other project
 * resource.
 */
export const ProjectPermission = {
  RunTasks: 1,
  UpdateProject: 2,
  ManageResources: 4,
  ManageUsers: 8,
} as const;

export type ProjectPermissionValue =
  (typeof ProjectPermission)[keyof typeof ProjectPermission];

/** Role → permission bitmask, mirroring `rolePermissions` in the server. */
export const ROLE_PERMISSIONS: Record<ProjectUserRole, number> = {
  owner:
    ProjectPermission.RunTasks |
    ProjectPermission.UpdateProject |
    ProjectPermission.ManageResources |
    ProjectPermission.ManageUsers,
  manager: ProjectPermission.RunTasks | ProjectPermission.ManageResources,
  task_runner: ProjectPermission.RunTasks,
  guest: 0,
};

const PERMISSION_LABELS: [number, string][] = [
  [ProjectPermission.RunTasks, "run_tasks"],
  [ProjectPermission.UpdateProject, "update_project"],
  [ProjectPermission.ManageResources, "manage_resources"],
  [ProjectPermission.ManageUsers, "manage_users"],
];

/** Human-readable list of the permissions contained in a bitmask. */
export function describePermissions(permissions: number): string[] {
  return PERMISSION_LABELS.filter(([bit]) => (permissions & bit) === bit).map(
    ([, label]) => label,
  );
}

export function hasPermission(permissions: number, required: number): boolean {
  return (permissions & required) === required;
}

/** Roles that grant `required`, cheapest first. */
export function rolesGranting(required: number): ProjectUserRole[] {
  const order: ProjectUserRole[] = ["guest", "task_runner", "manager", "owner"];
  return order.filter((role) => hasPermission(ROLE_PERMISSIONS[role], required));
}

/**
 * Permission the server demands for a request, derived from the routing table
 * of `api/router.go` (verified against v2.19.8).
 *
 * Reads are NOT listed on purpose: `GetMustCanMiddleware` lets every GET/HEAD
 * through regardless of role, so any project member can list templates, keys or
 * tasks. Only writes are gated.
 */
export function requiredPermissionFor(
  method: string,
  endpoint: string,
): { permission: number; label: string } | null {
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD") return null;

  const projectPath = /^\/project\/\d+(?<rest>\/.*)?$/.exec(endpoint);
  if (!projectPath) return null;

  const rest = projectPath.groups?.["rest"] ?? "";

  // PUT/DELETE on the project itself.
  if (rest === "") {
    return { permission: ProjectPermission.UpdateProject, label: "update_project" };
  }

  // Starting, stopping, confirming or rejecting tasks, and running workflows.
  if (/^\/tasks(\/|$)/.test(rest) || /^\/workflows\/\d+\/run(\/|$)/.test(rest)) {
    return { permission: ProjectPermission.RunTasks, label: "run_tasks" };
  }

  // Adding, updating or removing project members.
  if (/^\/users(\/|$)/.test(rest)) {
    return { permission: ProjectPermission.ManageUsers, label: "manage_users" };
  }

  // Everything else under the project is a resource: templates, keys,
  // repositories, inventory, environment, schedules, views, integrations,
  // workflows, runners, roles.
  return { permission: ProjectPermission.ManageResources, label: "manage_resources" };
}
