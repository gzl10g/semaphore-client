import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProject, buildClient, formatTable } from "../../src/cli/shared.js";
import { SemaphoreClient } from "../../src/client.js";

// — resolveProject —

test("resolveProject returns flag value when flag is provided", () => {
  assert.equal(resolveProject({ flag: 5 }), 5);
});

test("resolveProject returns parsed env value", () => {
  assert.equal(resolveProject({ env: "7" }), 7);
});

test("resolveProject returns config.activeProject when no flag or env", () => {
  assert.equal(resolveProject({ config: { version: 1, activeProject: 3 } }), 3);
});

test("resolveProject throws with helpful message when nothing provided", () => {
  assert.throws(
    () => resolveProject({}),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("No project specified"));
      return true;
    },
  );
});

test("resolveProject throws when env is not a valid integer", () => {
  assert.throws(
    () => resolveProject({ env: "abc" }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("SMPHE_PROJECT"));
      return true;
    },
  );
});

test("resolveProject respects flag > env > config precedence", () => {
  assert.equal(
    resolveProject({ flag: 5, env: "7", config: { version: 1, activeProject: 3 } }),
    5,
  );
});

// — buildClient —

test("buildClient throws 'Host not configured' when host is missing", () => {
  assert.throws(
    () => buildClient({ version: 1 }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("Host not configured"));
      return true;
    },
  );
});

test("buildClient throws 'Token not configured' when token is missing", () => {
  assert.throws(
    () => buildClient({ version: 1, host: "http://x" }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("Token not configured"));
      return true;
    },
  );
});

test("buildClient returns SemaphoreClient when host and token are present", () => {
  const client = buildClient({ version: 1, host: "http://x", token: "t" });
  assert.ok(client instanceof SemaphoreClient);
});

// — formatTable —

test("formatTable renders header, separator, and rows", () => {
  const rows = [
    { id: 1, name: "alpha" },
    { id: 2, name: "beta" },
  ];
  const columns = [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
  ];

  const output = formatTable(rows, columns);
  const lines = output.split("\n");

  assert.ok(lines.length >= 4, "should have header + separator + 2 rows");
  assert.ok(lines[0].includes("ID"), "header should include ID");
  assert.ok(lines[0].includes("Name"), "header should include Name");
  assert.ok(lines[1].includes("─"), "separator should use ─");
  assert.ok(lines[2].includes("alpha"), "first row should include alpha");
  assert.ok(lines[3].includes("beta"), "second row should include beta");
});
