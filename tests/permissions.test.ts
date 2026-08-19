import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ProjectPermission,
  ROLE_PERMISSIONS,
  describePermissions,
  hasPermission,
  rolesGranting,
  requiredPermissionFor,
} from "../src/permissions.js";

test("role permissions mirror the server bitmasks", () => {
  assert.equal(ROLE_PERMISSIONS.task_runner, 1);
  assert.equal(ROLE_PERMISSIONS.manager, 5);
  assert.equal(ROLE_PERMISSIONS.owner, 15);
  assert.equal(ROLE_PERMISSIONS.guest, 0);
});

test("describePermissions decodes a bitmask", () => {
  assert.deepEqual(describePermissions(1), ["run_tasks"]);
  assert.deepEqual(describePermissions(5), ["run_tasks", "manage_resources"]);
  assert.deepEqual(describePermissions(0), []);
});

test("hasPermission requires every bit of the mask", () => {
  assert.ok(hasPermission(5, ProjectPermission.ManageResources));
  assert.ok(!hasPermission(1, ProjectPermission.ManageResources));
});

test("rolesGranting lists roles from cheapest to most privileged", () => {
  assert.deepEqual(rolesGranting(ProjectPermission.ManageResources), ["manager", "owner"]);
  assert.deepEqual(rolesGranting(ProjectPermission.RunTasks), ["task_runner", "manager", "owner"]);
  assert.deepEqual(rolesGranting(ProjectPermission.ManageUsers), ["owner"]);
});

test("reads need no permission: GetMustCanMiddleware lets every GET through", () => {
  assert.equal(requiredPermissionFor("GET", "/project/1/templates"), null);
  assert.equal(requiredPermissionFor("HEAD", "/project/1/keys"), null);
});

test("creating a template needs manage_resources", () => {
  assert.deepEqual(requiredPermissionFor("POST", "/project/1/templates"), {
    permission: ProjectPermission.ManageResources,
    label: "manage_resources",
  });
  assert.deepEqual(requiredPermissionFor("PUT", "/project/1/templates/21"), {
    permission: ProjectPermission.ManageResources,
    label: "manage_resources",
  });
});

test("running or stopping a task needs run_tasks", () => {
  assert.equal(requiredPermissionFor("POST", "/project/1/tasks")?.label, "run_tasks");
  assert.equal(requiredPermissionFor("POST", "/project/1/tasks/99/stop")?.label, "run_tasks");
  assert.equal(requiredPermissionFor("POST", "/project/1/workflows/3/run")?.label, "run_tasks");
});

test("editing a workflow definition is a resource, not a run", () => {
  assert.equal(requiredPermissionFor("PUT", "/project/1/workflows/3")?.label, "manage_resources");
});

test("touching the project itself needs update_project", () => {
  assert.equal(requiredPermissionFor("PUT", "/project/1")?.label, "update_project");
  assert.equal(requiredPermissionFor("DELETE", "/project/1")?.label, "update_project");
});

test("managing members needs manage_users", () => {
  assert.equal(requiredPermissionFor("POST", "/project/1/users")?.label, "manage_users");
  assert.equal(requiredPermissionFor("DELETE", "/project/1/users/5")?.label, "manage_users");
});

test("endpoints outside a project are not mapped", () => {
  assert.equal(requiredPermissionFor("POST", "/projects"), null);
  assert.equal(requiredPermissionFor("POST", "/users"), null);
});
