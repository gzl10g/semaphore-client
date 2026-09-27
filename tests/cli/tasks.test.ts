import { test } from "node:test";
import assert from "node:assert/strict";
import type { SemaphoreClient } from "../../src/client.js";
import { SemaphoreApiError } from "../../src/error.js";
import type { Task, WaitForCompletionOptions } from "../../src/types.js";
import { ExitError } from "../../src/cli/shared.js";
import {
  handleTasksList,
  handleTasksGet,
  handleTasksRun,
  handleTasksWait,
  handleTasksOutput, handleTasksStop } from "../../src/cli/tasks.js";

const MOCK_TASK = {
  id: 1,
  template_id: 10,
  project_id: 1,
  status: "success" as const,
  debug: false,
  dry_run: false,
  created: "2024-01-01T00:00:00Z",
};

const MOCK_OUTPUT = [
  { task_id: 1, time: "2024-01-01T00:00:01Z", output: "Hello" },
  { task_id: 1, time: "2024-01-01T00:00:02Z", output: "World" },
];

let runCallArgs: unknown = null;

const mockClient = {
  tasks: {
    list: async () => [MOCK_TASK],
    get: async (_pid: number, id: number) => (id === 1 ? MOCK_TASK : null),
    run: async (_pid: number, input: unknown) => {
      runCallArgs = input;
      return { ...MOCK_TASK, id: 99 };
    },
    stop: async () => {},
    output: async () => MOCK_OUTPUT,
  },
} as unknown as SemaphoreClient;

const DEPS = { client: mockClient, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };

function captureLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return { lines, restore: () => { console.log = original; } };
}

test("handleTasksList outputs table with task data", async () => {
  const cap = captureLog();
  try {
    await handleTasksList(1, { json: false }, DEPS);
  } finally {
    cap.restore();
  }
  const output = cap.lines.join("\n");
  assert.ok(output.includes("success"), `Expected "success" in output:\n${output}`);
});

test("handleTasksList json:true outputs JSON array", async () => {
  const cap = captureLog();
  try {
    await handleTasksList(1, { json: true }, DEPS);
  } finally {
    cap.restore();
  }
  const parsed = JSON.parse(cap.lines.join("\n")) as unknown[];
  assert.ok(Array.isArray(parsed));
  assert.equal((parsed[0] as { id: number }).id, 1);
});

test("handleTasksGet id:99 throws Error for not found", async () => {
  await assert.rejects(
    () => handleTasksGet(1, 99, { json: false }, DEPS),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("not found"));
      return true;
    },
  );
});

test("handleTasksRun passes arguments and playbook to client.tasks.run", async () => {
  runCallArgs = null;
  // Cambio deliberado (2026-09-27): --arguments falla cerrado si la plantilla no
  // se puede leer, y el mock común no tiene plantillas. Se le da una que permite
  // sobrescribir los argumentos: este test sigue probando la fontanería.
  const client = {
    ...mockClient,
    templates: { get: async () => ({ id: 10, name: "Deploy", app: "ansible", allow_override_args_in_task: true }) },
  } as unknown as SemaphoreClient;
  const cap = captureLog();
  try {
    await handleTasksRun(
      1,
      10,
      { arguments: '["--verbose"]', playbook: "site.yml" },
      { json: true },
      { ...DEPS, client },
    );
  } finally {
    cap.restore();
  }
  assert.ok(runCallArgs !== null);
  const args = runCallArgs as { arguments?: string; playbook?: string; templateId: number };
  assert.equal(args.arguments, '["--verbose"]');
  assert.equal(args.playbook, "site.yml");
  assert.equal(args.templateId, 10);
});

test("handleTasksOutput prints lines as [time] output format", async () => {
  const cap = captureLog();
  try {
    await handleTasksOutput(1, 1, { json: false }, DEPS);
  } finally {
    cap.restore();
  }
  const output = cap.lines.join("\n");
  assert.ok(output.includes("[2024-01-01T00:00:01Z] Hello"));
  assert.ok(output.includes("[2024-01-01T00:00:02Z] World"));
});

// ── --limit guardrail ──

function clientForLimit(template: Record<string, unknown> | null): {
  client: SemaphoreClient;
  runs: unknown[];
} {
  const runs: unknown[] = [];
  const client = {
    templates: { get: async () => template },
    tasks: {
      run: async (_projectId: number, input: unknown) => {
        runs.push(input);
        return { id: 1, template_id: 6, project_id: 1, status: "waiting", created: "2024-01-01" };
      },
    },
  } as unknown as SemaphoreClient;
  return { client, runs };
}

const CONFIG_P1 = { version: 1 as const, host: "http://s", token: "t", activeProject: 1 };

test("--limit is refused when the template forbids overriding it", async () => {
  const { client, runs } = clientForLimit({ id: 6, name: "Update web servers" });
  await assert.rejects(
    () => handleTasksRun(1, 6, { limit: "web02" }, {}, { client, config: CONFIG_P1 }),
    /would silently ignore --limit/,
  );
  assert.equal(runs.length, 0, "the task must not be created");
});

test("the refusal names the template's own limit when it has one", async () => {
  const { client } = clientForLimit({
    id: 6,
    name: "Deploy",
    task_params: { limit: ["app01.example.test"] },
  });
  await assert.rejects(
    () => handleTasksRun(1, 6, { limit: "otro" }, {}, { client, config: CONFIG_P1 }),
    /app01\.example\.test/,
  );
});

test("--limit goes through when the template allows the override", async () => {
  const { client, runs } = clientForLimit({
    id: 6,
    name: "Update web servers",
    task_params: { allow_override_limit: true },
  });
  const cap = captureLog();
  try {
    await handleTasksRun(1, 6, { limit: "web02" }, { json: true }, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
  }
  assert.equal(runs.length, 1);
  assert.equal((runs[0] as { limit?: string }).limit, "web02");
});

// Cambio de contrato deliberado (P8): antes, una run sin overrides no leía la
// plantilla ("the happy path must not pay an extra request"). Ahora la lee
// siempre, porque una plantilla deploy sin build_task_id corre SIN versión y sin
// error, y solo leyéndola se sabe que es deploy. Lo que se mantiene: una
// plantilla que no se puede leer no bloquea una run sin overrides.
test("a run without overrides reads the template once, and a missing one does not block it", async () => {
  let reads = 0;
  const runs: unknown[] = [];
  const client = {
    templates: { get: async () => { reads++; return null; } },
    tasks: { run: async (_p: number, input: unknown) => { runs.push(input); return { id: 1, template_id: 6, project_id: 1, status: "waiting", created: "x" }; } },
  } as unknown as SemaphoreClient;
  const cap = captureLog();
  try {
    await handleTasksRun(1, 6, {}, { json: true }, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
  }
  assert.equal(reads, 1, "one read, for the deploy check");
  assert.equal(runs.length, 1);
});

// Cambio de contrato deliberado (decisión del usuario, 2026-09-27): este test
// decía que una plantilla ilegible no bloqueaba un --limit. Pero si no se puede
// comprobar `allow_override_limit` y el servidor lo ignora, el playbook corre en
// TODO el inventario. Ahora --limit falla cerrado, y lo que sigue pasando con una
// plantilla ilegible es solo lo inocuo si se ignora (--debug).
test("an unreadable template blocks a --limit, and still lets a harmless --debug through", async () => {
  const runs: unknown[] = [];
  const client = {
    templates: { get: async () => { throw new Error("boom"); } },
    tasks: {
      run: async (_p: number, input: unknown) => { runs.push(input); return { id: 1, template_id: 6, project_id: 1, status: "waiting", created: "x" }; },
    },
  } as unknown as SemaphoreClient;
  await assert.rejects(
    () => handleTasksRun(1, 6, { limit: "web02" }, { json: true }, { client, config: CONFIG_P1 }),
    /--limit needs to read template 6.*Nothing was run/,
  );
  assert.equal(runs.length, 0, "the task must not be created");

  const cap = captureLog();
  const err = captureErr();
  try {
    await handleTasksRun(1, 6, { debug: true }, { json: true }, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
    err.restore();
  }
  assert.equal(runs.length, 1);
});

test("--arguments is refused when the template forbids overriding args", async () => {
  const { client, runs } = clientForLimit({ id: 6, name: "Deploy" });
  await assert.rejects(
    () => handleTasksRun(1, 6, { arguments: '["-e","x=1"]' }, {}, { client, config: CONFIG_P1 }),
    /would silently ignore --arguments/,
  );
  assert.equal(runs.length, 0);
});

test("--debug is refused when the template does not allow debug", async () => {
  const { client, runs } = clientForLimit({ id: 6, name: "Deploy" });
  await assert.rejects(
    () => handleTasksRun(1, 6, { debug: true }, {}, { client, config: CONFIG_P1 }),
    /would silently ignore --debug/,
  );
  assert.equal(runs.length, 0);
});

test("several dropped overrides are reported together", async () => {
  const { client } = clientForLimit({ id: 6, name: "Deploy" });
  await assert.rejects(
    () => handleTasksRun(1, 6, { limit: "h1", debug: true }, {}, { client, config: CONFIG_P1 }),
    /--limit, --debug/,
  );
});

// Cambio de contrato deliberado: --dry-run y --playbook salían de esta lista
// porque "siempre aplican". No es verdad: solo ansible los honra, y en
// bash/python/terraform la task corre de verdad con su propio script. Ahora
// leen la plantilla (tests de --dry-run y --playbook más abajo).
// Segundo cambio (P8): la plantilla se lee en toda run —ver el test de arriba—,
// así que lo que se comprueba ya no es que no se lea, sino que --environment y
// --message pasan sin puerta aunque la plantilla no se pueda leer.
// Tercer cambio (2026-09-27, decisión del usuario): --build-task-id sale de aquí.
// Sin la plantilla no se puede comprobar que la build sea suya, y el servidor
// despliega la versión de la build de CUALQUIER plantilla: ahora falla cerrado.
test("flags that always apply go through without a template gate", async () => {
  const runs: unknown[] = [];
  const client = {
    templates: { get: async () => null },
    tasks: {
      run: async (_p: number, input: unknown) => { runs.push(input); return { id: 1, template_id: 6, project_id: 1, status: "waiting", created: "x" }; },
      get: async () => ({ id: 3, template_id: 5, project_id: 1, status: "success", created: "x", dry_run: false }),
    },
  } as unknown as SemaphoreClient;
  const cap = captureLog();
  try {
    await handleTasksRun(1, 6, { environment: "{}", message: "m" }, { json: true }, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
  }
  assert.equal(runs.length, 1, "--environment and --message always apply");
  const sent = runs[0] as { environment?: string; message?: string };
  assert.deepEqual([sent.environment, sent.message], ["{}", "m"]);
});

test("--playbook is refused on a non-ansible template, which runs its own script", async () => {
  const { client, runs } = clientForLimit({ id: 7, name: "Backup", app: "bash" });
  await assert.rejects(
    () => handleTasksRun(1, 7, { playbook: "other.sh" }, {}, { client, config: CONFIG_P1 }),
    /bash template.*only honours --playbook on ansible/,
  );
  assert.equal(runs.length, 0);
});

// Cambio deliberado (2026-09-27): antes también pasaba con la plantilla ilegible.
// Pero en bash/python/terraform el servidor ejecuta el playbook de la plantilla,
// no el pedido, y sin leerla no se sabe el app: ahora falla cerrado (ver
// «an unreadable template that THROWS blocks…»).
test("--playbook goes through on an ansible template", async () => {
  for (const template of [{ id: 6, name: "Deploy", app: "ansible" }]) {
    const { client, runs } = clientForLimit(template);
    const cap = captureLog();
    try {
      await handleTasksRun(1, 6, { playbook: "site.yml" }, { json: true }, { client, config: CONFIG_P1 });
    } finally {
      cap.restore();
    }
    assert.equal(runs.length, 1);
  }
});

// — --dry-run: un check que no lo es corre de verdad, y responde success —

function clientForDryRun(template: Record<string, unknown> | null | Error, created: Record<string, unknown>) {
  const runs: unknown[] = [];
  const stops: unknown[][] = [];
  const client = {
    templates: {
      get: async () => {
        if (template instanceof Error) throw template;
        return template;
      },
    },
    tasks: {
      run: async (_p: number, input: unknown) => { runs.push(input); return created; },
      stop: async (...args: unknown[]) => { stops.push(args); },
    },
  } as unknown as SemaphoreClient;
  return { client, runs, stops };
}

const CREATED_CHECK = { id: 7, template_id: 6, project_id: 1, status: "waiting", created: "x", dry_run: true, params: { dry_run: true } };

test("--dry-run reaches the resource and the stored flag is accepted", async () => {
  const { client, runs, stops } = clientForDryRun({ id: 6, name: "Deploy", app: "ansible" }, CREATED_CHECK);
  const cap = captureLog();
  try {
    await handleTasksRun(1, 6, { dryRun: true }, { json: true }, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
  }
  assert.equal((runs[0] as { dryRun?: boolean }).dryRun, true);
  assert.equal(stops.length, 0);
  assert.equal((JSON.parse(cap.lines.join("\n")) as { dry_run: boolean }).dry_run, true);
});

test("--dry-run is refused on a non-ansible template, which would run for real", async () => {
  const { client, runs } = clientForDryRun({ id: 6, name: "Backup", app: "bash" }, CREATED_CHECK);
  await assert.rejects(
    () => handleTasksRun(1, 6, { dryRun: true }, {}, { client, config: CONFIG_P1 }),
    /bash template.*only honours --dry-run on ansible/,
  );
  assert.equal(runs.length, 0, "the task must not be created");
});

test("--dry-run fails closed when the template cannot be read", async () => {
  for (const template of [null, new Error("boom")]) {
    const { client, runs } = clientForDryRun(template, CREATED_CHECK);
    await assert.rejects(
      () => handleTasksRun(1, 6, { dryRun: true }, {}, { client, config: CONFIG_P1 }),
      /--dry-run needs to read template 6/,
    );
    assert.equal(runs.length, 0);
  }
});

const UNCHECKED = { id: 8, template_id: 6, project_id: 1, status: "waiting", created: "x", dry_run: false };

/** `tasks.get` answers each status of `reads` in turn, then repeats the last. */
function withReads(client: SemaphoreClient, reads: Record<string, unknown>[]): void {
  let i = 0;
  (client.tasks as unknown as { get: () => Promise<unknown> }).get = async () =>
    ({ ...UNCHECKED, ...reads[Math.min(i++, reads.length - 1)] });
}

test("a task created without dry_run is stopped WITHOUT force, and the command fails", async () => {
  // Con force, una task encolada queda `stopped` pero sigue en la cola y corre
  // de verdad (medido en 2.19.12): la parada tiene que ser la normal.
  const { client, stops } = clientForDryRun({ id: 6, name: "Deploy", app: "ansible" }, UNCHECKED);
  withReads(client, [{ status: "waiting" }, { status: "stopped" }]);
  await assert.rejects(
    () => handleTasksRun(1, 6, { dryRun: true }, {}, { client, config: CONFIG_P1 }),
    /Task 8 was created WITHOUT dry_run.*stopped before it started: nothing ran/,
  );
  assert.deepEqual(stops[0], [1, 8]);
});

test("if the unchecked task had started, the error says it ran", async () => {
  const { client } = clientForDryRun({ id: 6, name: "Deploy", app: "ansible" }, UNCHECKED);
  withReads(client, [{ status: "running", start: "t0" }, { status: "stopped", start: "t0" }]);
  await assert.rejects(
    () => handleTasksRun(1, 6, { dryRun: true }, {}, { client, config: CONFIG_P1 }),
    /STARTED at t0 and ended stopped: it ran for real/,
  );
});

test("an unchecked task that already finished is not stopped: that would rewrite its status", async () => {
  const { client, stops } = clientForDryRun({ id: 6, name: "Deploy", app: "ansible" }, UNCHECKED);
  withReads(client, [{ status: "success", start: "t0" }]);
  await assert.rejects(
    () => handleTasksRun(1, 6, { dryRun: true }, {}, { client, config: CONFIG_P1 }),
    /already finished.*STARTED at t0 and ended success/,
  );
  assert.equal(stops.length, 0);
});

test("if stopping the unchecked task fails, the error says so", async () => {
  const { client } = clientForDryRun({ id: 6, name: "Deploy", app: "ansible" }, UNCHECKED);
  withReads(client, [{ status: "waiting" }]);
  (client.tasks as unknown as { stop: () => Promise<void> }).stop = async () => { throw new Error("403"); };
  await assert.rejects(
    () => handleTasksRun(1, 6, { dryRun: true }, {}, { client, config: CONFIG_P1 }),
    /Stopping it FAILED \(403\).*tasks stop 8`/,
  );
});

test("a run answered without a task cannot be verified and says so", async () => {
  const { client } = clientForDryRun({ id: 6, name: "Deploy", app: "ansible" }, undefined as unknown as Record<string, unknown>);
  await assert.rejects(
    () => handleTasksRun(1, 6, { dryRun: true }, {}, { client, config: CONFIG_P1 }),
    /without the task it created.*may be running for real/,
  );
});

test("an unchecked task that ended in error without a start is not called harmless", async () => {
  const { client } = clientForDryRun({ id: 6, name: "Deploy", app: "ansible" }, UNCHECKED);
  withReads(client, [{ status: "waiting" }, { status: "error" }]);
  await assert.rejects(
    () => handleTasksRun(1, 6, { dryRun: true }, {}, { client, config: CONFIG_P1 }),
    /ended error with no start time, so whether it ran is unknown/,
  );
});

for (const status of ["waiting", "stopping"]) test(`tasks stop --force on a ${status} task stops it normally: force would leave it queued`, async () => {
  const stops: unknown[][] = [];
  const client = {
    tasks: {
      get: async () => ({ ...UNCHECKED, status }),
      stop: async (...args: unknown[]) => { stops.push(args); },
    },
  } as unknown as SemaphoreClient;
  const cap = captureLog();
  const err = captureErr();
  try {
    await handleTasksStop(1, 8, { force: true }, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
    err.restore();
  }
  assert.deepEqual(stops, [[1, 8]]);
  assert.match(err.lines.join("\n"), /not running: --force would leave it queued/);
});

test("an HTTP error mid-wait is reported as is, not as a lost connection", async () => {
  const client = clientForWait(new SemaphoreApiError(403, "Forbidden"));
  await assert.rejects(
    () => handleTasksWait(1, 9, {}, { client, config: CONFIG_P1 }),
    (e: unknown) => e instanceof SemaphoreApiError && e.status === 403,
  );
});

// — --wait / tasks wait: el código de salida dice cómo acabó —

function clientForWait(outcome: Record<string, unknown> | SemaphoreApiError, polls: string[] = []) {
  const client = {
    tasks: {
      run: async () => ({ id: 9, template_id: 6, project_id: 1, status: "waiting", created: "x" }),
      waitForCompletion: async (_p: number, _id: number, o?: WaitForCompletionOptions) => {
        for (const status of polls) o?.onPoll?.({ id: 9, template_id: 6, project_id: 1, status, created: "x" } as Task);
        if (outcome instanceof SemaphoreApiError) throw outcome;
        return outcome;
      },
    },
  } as unknown as SemaphoreClient;
  return client;
}

function captureErr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  return { lines, restore: () => { console.error = original; } };
}

const FINAL = (status: string) => ({ id: 9, template_id: 6, project_id: 1, status, created: "x" });

test("run --wait prints only the final task on stdout and exits 0 on success", async () => {
  const client = clientForWait(FINAL("success"));
  const cap = captureLog();
  const err = captureErr();
  try {
    await handleTasksRun(1, 6, {}, { json: true, wait: true }, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
    err.restore();
  }
  assert.equal((JSON.parse(cap.lines.join("\n")) as { status: string }).status, "success");
  assert.match(err.lines.join("\n"), /Task 9 created, waiting/);
});

test("each final status maps to its exit code, after printing the task", async () => {
  for (const [status, code] of [["error", 2], ["stopped", 3]] as const) {
    const cap = captureLog();
    try {
      await assert.rejects(
        () => handleTasksWait(1, 9, { json: true }, { client: clientForWait(FINAL(status)), config: CONFIG_P1 }),
        (e: unknown) => e instanceof ExitError && e.exitCode === code,
      );
    } finally {
      cap.restore();
    }
    assert.equal((JSON.parse(cap.lines.join("\n")) as { status: string }).status, status);
  }
});

test("a timeout exits 124, names the last status and prints the last task", async () => {
  // Sin --progress: el último estado se recordaba solo con --progress.
  const client = clientForWait(new SemaphoreApiError(0, "Timeout", "TIMEOUT"), ["running"]);
  const cap = captureLog();
  try {
    await assert.rejects(
      () => handleTasksWait(1, 9, { timeout: 5, json: true }, { client, config: CONFIG_P1 }),
      (e: unknown) => e instanceof ExitError && e.exitCode === 124 && /after 5s .*\(last status: running\).*keeps running/.test(e.message),
    );
  } finally {
    cap.restore();
  }
  assert.equal((JSON.parse(cap.lines.join("\n")) as { status: string }).status, "running");
});

test("waiting for approval is announced once even without --progress", async () => {
  const client = clientForWait(FINAL("success"), ["waiting_confirmation", "waiting_confirmation", "success"]);
  const cap = captureLog();
  const err = captureErr();
  try {
    await handleTasksWait(1, 9, {}, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
    err.restore();
  }
  assert.equal(err.lines.filter((l) => /waiting for approval/.test(l)).length, 1);
});

test("losing the server mid-wait says the task may still be running", async () => {
  const client = clientForWait(new SemaphoreApiError(0, "fetch failed"));
  await assert.rejects(
    () => handleTasksWait(1, 9, {}, { client, config: CONFIG_P1 }),
    (e: unknown) => !(e instanceof ExitError) && e instanceof Error && /Lost track of task 9.*tasks wait 9/.test(e.message),
  );
});

test("a rejected task exits 4", async () => {
  const client = clientForWait(new SemaphoreApiError(0, "Task 9 was rejected", "REJECTED"));
  await assert.rejects(
    () => handleTasksWait(1, 9, {}, { client, config: CONFIG_P1 }),
    (e: unknown) => e instanceof ExitError && e.exitCode === 4,
  );
});

test("--progress prints each status change once, to stderr", async () => {
  const client = clientForWait(FINAL("success"), ["waiting", "running", "running", "success"]);
  const cap = captureLog();
  const err = captureErr();
  try {
    await handleTasksWait(1, 9, { progress: true }, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
    err.restore();
  }
  assert.deepEqual(err.lines.map((l) => l.replace(/^\[[^\]]+\] /, "")), [
    "task 9: waiting",
    "task 9: running",
    "task 9: success",
  ]);
});

test("each override goes through once its own flag is enabled", async () => {
  const { client, runs } = clientForLimit({
    id: 6,
    name: "Deploy",
    allow_override_args_in_task: true,
    task_params: { allow_override_limit: true, allow_debug: true },
  });
  const cap = captureLog();
  try {
    await handleTasksRun(1, 6, { limit: "h1", debug: true, arguments: "[]" }, { json: true }, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
  }
  assert.equal(runs.length, 1);
});

// — el P0 en su capa: el flag llega al recurso y la salida respeta --json —

test("tasks stop pasa --force al recurso y lo dice en la salida JSON", async () => {
  const calls: unknown[][] = [];
  const client = {
    tasks: { stop: async (...args: unknown[]) => { calls.push(args); } },
  } as unknown as SemaphoreClient;
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };

  const cap = captureLog();
  try {
    await handleTasksStop(1, 5, { force: true, json: true }, deps);
  } finally {
    cap.restore();
  }

  assert.deepEqual(calls[0], [1, 5, { force: true }]);
  assert.deepEqual(JSON.parse(cap.lines.join("\n")), {
    ok: true, message: "Task 5 killed", id: 5, force: true,
  });
});

test("tasks stop sin --force sigue imprimiendo la línea de siempre", async () => {
  const client = {
    tasks: { stop: async () => {} },
  } as unknown as SemaphoreClient;
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };

  const cap = captureLog();
  try {
    await handleTasksStop(1, 5, {}, deps);
  } finally {
    cap.restore();
  }
  assert.deepEqual(cap.lines, ["Task 5 stopped"]);
});

test("tasks run rechaza un --arguments con forma inválida y acepta no pasarlo", async () => {
  const client = {
    templates: { get: async () => null },
    tasks: { run: async () => ({ id: 1, status: "waiting" }) },
  } as unknown as SemaphoreClient;
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };

  await assert.rejects(
    () => handleTasksRun(1, 10, { arguments: "42" }, { json: true }, deps),
    (e: unknown) => e instanceof Error && /--arguments/.test(e.message),
  );

  // Sin el flag no debe validar nada: es el camino del 99% de las ejecuciones.
  const cap = captureLog();
  try {
    await handleTasksRun(1, 10, {}, { json: true }, deps);
  } finally {
    cap.restore();
  }
});

test("tasks run rechaza el mapa de stages en una plantilla ansible, que revienta al ejecutar", async () => {
  const client = {
    templates: {
      get: async () => ({
        id: 10, name: "ansible-tpl", app: "ansible", project_id: 1,
        inventory_id: 1, repository_id: 1, environment_id: 1, playbook: "site.yml",
        task_params: { allow_override_args_in_task: true },
        allow_override_args_in_task: true,
      }),
    },
    tasks: { run: async () => ({ id: 1, status: "waiting" }) },
  } as unknown as SemaphoreClient;
  const deps = { client, config: { version: 1 as const, host: "http://x", token: "t", activeProject: 1 } };

  await assert.rejects(
    () => handleTasksRun(1, 10, { arguments: '{"init":["-upgrade"]}' }, { json: true }, deps),
    (e: unknown) => e instanceof Error && /terraform/.test(e.message),
    "el mapa de stages solo es ejecutable en terraform/tofu/terragrunt",
  );
});

// — tasks stop sobre una task terminada: parar la reescribiría a `stopped` —

test("tasks stop on a finished task does not call the server and says so", async () => {
  for (const status of ["success", "error", "stopped"]) {
    const stops: unknown[][] = [];
    const client = {
      tasks: {
        get: async () => ({ id: 5, template_id: 6, project_id: 1, status, created: "x", dry_run: false }),
        stop: async (...args: unknown[]) => { stops.push(args); },
      },
    } as unknown as SemaphoreClient;
    const cap = captureLog();
    try {
      await handleTasksStop(1, 5, { force: true, json: true }, { client, config: CONFIG_P1 });
    } finally {
      cap.restore();
    }
    assert.equal(stops.length, 0, `${status}: must not be rewritten to stopped`);
    assert.deepEqual(JSON.parse(cap.lines.join("\n")), {
      ok: true, message: `Task 5 already finished (${status}): nothing to stop`, id: 5, alreadyFinished: status,
    });
  }
});

test("tasks stop --force on a running task still forces it", async () => {
  const stops: unknown[][] = [];
  const client = {
    tasks: {
      get: async () => ({ id: 5, template_id: 6, project_id: 1, status: "running", created: "x", dry_run: false }),
      stop: async (...args: unknown[]) => { stops.push(args); },
    },
  } as unknown as SemaphoreClient;
  const cap = captureLog();
  try {
    await handleTasksStop(1, 5, { force: true }, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
  }
  assert.deepEqual(stops, [[1, 5, { force: true }]]);
  assert.deepEqual(cap.lines, ["Task 5 killed"]);
});

// ── P5: --environment son extra vars, y tienen que ser un objeto JSON ──

test("--environment that is not a JSON object is refused before creating anything", async () => {
  // Medido en 2.19.12: `notjson` y `["a"]` crean la task en `error` y responden 500 sin cuerpo.
  for (const bad of ["notjson", '["a"]', "null", "3", '"x"']) {
    const { client, runs } = clientForLimit(null);
    await assert.rejects(
      () => handleTasksRun(1, 6, { environment: bad }, {}, { client, config: CONFIG_P1 }),
      /--environment must be a JSON object of extra variables/,
      bad,
    );
    assert.equal(runs.length, 0, bad);
  }
});

// ── P6: overrides de ansible con su puerta de plantilla ──

function clientForOverrides(template: Record<string, unknown> | null, extra: Record<string, unknown> = {}) {
  const { client, runs } = clientForLimit(template);
  const c = client as unknown as Record<string, unknown>;
  c["inventory"] = { get: async (_p: number, id: number) => (id === 404 ? null : { id }) };
  Object.assign(c, extra);
  return { client, runs };
}

async function runQuiet(client: SemaphoreClient, runOpts: Record<string, unknown>, templateId = 6): Promise<void> {
  const cap = captureLog();
  const err = captureErr();
  try {
    await handleTasksRun(1, templateId, runOpts, { json: true }, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
    err.restore();
  }
}

test("each new ansible override is refused while its template gate is off, naming the gate", async () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ tags: ["a"] }, /--tags: enable "Allow override tags"/],
    [{ skipTags: ["a"] }, /--skip-tags: enable "Allow override skip tags"/],
    [{ inventoryId: 2 }, /--inventory-id: enable "Allow override inventory"/],
    [{ gitBranch: "dev" }, /--git-branch: enable "Allow override branch in task"/],
    [{ debugLevel: 3 }, /--debug-level: enable "Allow debug"/],
  ];
  for (const [opts, re] of cases) {
    const { client, runs } = clientForOverrides({ id: 6, name: "Deploy", app: "ansible" });
    await assert.rejects(() => handleTasksRun(1, 6, opts, {}, { client, config: CONFIG_P1 }), re);
    assert.equal(runs.length, 0, JSON.stringify(opts));
  }
});

test("with every gate on, the new overrides reach the resource, and --debug-level implies --debug", async () => {
  const { client, runs } = clientForOverrides({
    id: 6,
    name: "Deploy",
    app: "ansible",
    allow_override_branch_in_task: true,
    task_params: { allow_override_tags: true, allow_override_skip_tags: true, allow_override_inventory: true, allow_debug: true },
  });
  await runQuiet(client, { tags: ["a", "b"], skipTags: ["c"], inventoryId: 2, gitBranch: "dev", debugLevel: 2, message: "why" });
  assert.equal(runs.length, 1);
  const sent = runs[0] as Record<string, unknown>;
  assert.deepEqual(
    [sent["tags"], sent["skipTags"], sent["inventoryId"], sent["gitBranch"], sent["debugLevel"], sent["debug"], sent["message"]],
    [["a", "b"], ["c"], 2, "dev", 2, true, "why"],
  );
});

test("--debug-level outside 1-6 is refused before touching the server", async () => {
  for (const level of [0, 7, -1]) {
    const { client, runs } = clientForOverrides({ id: 6, name: "Deploy", task_params: { allow_debug: true } });
    await assert.rejects(() => handleTasksRun(1, 6, { debugLevel: level }, {}, { client, config: CONFIG_P1 }), /between 1 and 6/);
    assert.equal(runs.length, 0);
  }
});

test("--inventory-id of an inventory that does not exist is refused: Semaphore would fall back to the template's", async () => {
  const { client, runs } = clientForOverrides({ id: 6, name: "Deploy", task_params: { allow_override_inventory: true } });
  await assert.rejects(
    () => handleTasksRun(1, 6, { inventoryId: 404 }, {}, { client, config: CONFIG_P1 }),
    /Inventory 404 does not exist.*template's inventory instead/,
  );
  assert.equal(runs.length, 0);
});

test("ansible-only overrides on a terraform template say there is nothing to enable", async () => {
  const { client } = clientForOverrides({ id: 6, name: "Infra", app: "terraform", task_params: {} });
  await assert.rejects(
    () => handleTasksRun(1, 6, { tags: ["a"] }, {}, { client, config: CONFIG_P1 }),
    /--tags: only ansible templates read it/,
  );
});

// ── P7: terraform/tofu ──

test("terraform flags are refused on a non-terraform template, which would run for real", async () => {
  for (const flag of ["plan", "destroy", "autoApprove", "upgrade", "reconfigure"]) {
    const { client, runs } = clientForOverrides({ id: 6, name: "Deploy", app: "ansible" });
    await assert.rejects(
      () => handleTasksRun(1, 6, { [flag]: true }, {}, { client, config: CONFIG_P1 }),
      /only applies to terraform, tofu and terragrunt templates/,
      flag,
    );
    assert.equal(runs.length, 0, flag);
  }
});

test("--destroy is refused unless the template allows it: the server itself would not stop it", async () => {
  const { client, runs } = clientForOverrides({ id: 6, name: "Infra", app: "tofu", task_params: {} });
  await assert.rejects(
    () => handleTasksRun(1, 6, { destroy: true }, {}, { client, config: CONFIG_P1 }),
    /does not allow --destroy \("Allow destroy" is off\)\. Semaphore would destroy anyway/,
  );
  assert.equal(runs.length, 0);
});

test("--auto-approve needs allow_auto_approve, or a template that already auto-approves", async () => {
  const refused = clientForOverrides({ id: 6, name: "Infra", app: "terraform", task_params: {} });
  await assert.rejects(() => handleTasksRun(1, 6, { autoApprove: true }, {}, { client: refused.client, config: CONFIG_P1 }), /--auto-approve: enable "Allow auto approve"/);
  for (const task_params of [{ allow_auto_approve: true }, { auto_approve: true }]) {
    const { client, runs } = clientForOverrides({ id: 6, name: "Infra", app: "terraform", task_params });
    await runQuiet(client, { autoApprove: true });
    assert.equal(runs.length, 1);
  }
});

test("--plan, --destroy (allowed), --upgrade and --reconfigure reach the resource on a terraform template", async () => {
  const { client, runs } = clientForOverrides({ id: 6, name: "Infra", app: "terragrunt", task_params: { allow_destroy: true } });
  await runQuiet(client, { plan: true, destroy: true, upgrade: true, reconfigure: true });
  const sent = runs[0] as Record<string, unknown>;
  assert.deepEqual([sent["plan"], sent["destroy"], sent["upgrade"], sent["reconfigure"]], [true, true, true, true]);
});

test("--plan and --destroy fail closed when the template cannot be read", async () => {
  for (const opts of [{ plan: true }, { destroy: true }]) {
    for (const template of [null, new Error("boom")]) {
      const { client, runs } = clientForDryRun(template, CREATED_CHECK);
      await assert.rejects(() => handleTasksRun(1, 6, opts, {}, { client, config: CONFIG_P1 }), /needs to read template 6/);
      assert.equal(runs.length, 0);
    }
  }
});

// ── P8: deploy ──

function clientForDeploy(builds: Record<string, unknown>[], taskExists = true) {
  const { client, runs } = clientForOverrides({ id: 6, name: "Deploy app", app: "ansible", type: "deploy", build_template_id: 5 });
  const c = client as unknown as { templates: Record<string, unknown>; tasks: Record<string, unknown> };
  c.templates["tasks"] = async (_p: number, tplId: number) => (tplId === 5 ? builds : []);
  c.tasks["get"] = async (_p: number, id: number) => (taskExists ? { id, status: "success", template_id: 5 } : null);
  return { client, runs };
}

test("a deploy without --build-task-id deploys the latest successful build, like the UI", async () => {
  const { client, runs } = clientForDeploy([
    { id: 12, status: "error", version: "1.3" },
    { id: 11, status: "success", version: "1.2" },
    { id: 10, status: "success", version: "1.1" },
  ]);
  const err = captureErr();
  const cap = captureLog();
  try {
    await handleTasksRun(1, 6, {}, { json: true }, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
    err.restore();
  }
  assert.equal((runs[0] as { buildTaskId?: number }).buildTaskId, 11);
  assert.match(err.lines.join("\n"), /build task 11 \(version 1\.2\)/);
});

test("a deploy with no successful build is refused instead of running without a version", async () => {
  const { client, runs } = clientForDeploy([{ id: 12, status: "error" }]);
  await assert.rejects(() => handleTasksRun(1, 6, {}, {}, { client, config: CONFIG_P1 }), /no successful build to deploy/);
  assert.equal(runs.length, 0);
});

test("--build-task-id wins over the default, and one that does not exist is refused", async () => {
  const ok = clientForDeploy([{ id: 11, status: "success" }]);
  await runQuiet(ok.client, { buildTaskId: 10 });
  assert.equal((ok.runs[0] as { buildTaskId?: number }).buildTaskId, 10);

  const missing = clientForDeploy([], false);
  await assert.rejects(() => handleTasksRun(1, 6, { buildTaskId: 99 }, {}, { client: missing.client, config: CONFIG_P1 }), /Build task 99 does not exist/);
  assert.equal(missing.runs.length, 0);
});

test("a non-deploy template gets no build task", async () => {
  const { client, runs } = clientForOverrides({ id: 6, name: "Task", app: "ansible", type: "" });
  await runQuiet(client, {});
  assert.equal((runs[0] as { buildTaskId?: number }).buildTaskId, undefined);
});

// ── Revisión unidad A: regresiones ──

test("ansible overrides are refused on a non-ansible template even with a leftover allow_* (both reviewers)", async () => {
  for (const app of ["bash", "terraform"]) {
    const { client, runs } = clientForOverrides({ id: 6, name: "Was ansible", app, task_params: { allow_override_tags: true, allow_debug: true, allow_override_limit: true } });
    for (const opts of [{ tags: ["x"] }, { debugLevel: 3 }, { limit: "h" }]) {
      await assert.rejects(() => handleTasksRun(1, 6, opts, {}, { client, config: CONFIG_P1 }), /only ansible templates read it/, `${app} ${JSON.stringify(opts)}`);
    }
    assert.equal(runs.length, 0, app);
  }
});

test("--build-task-id must be a successful task of the deploy template's build template", async () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ template_id: 2, status: "success" }, /belongs to template 2, not to 5/],
    [{ template_id: 5, status: "error" }, /ended error, not success/],
  ];
  for (const [build, re] of cases) {
    const { client, runs } = clientForDeploy([]);
    (client.tasks as unknown as Record<string, unknown>)["get"] = async (_p: number, id: number) => ({ id, ...build });
    await assert.rejects(() => handleTasksRun(1, 6, { buildTaskId: 26 }, {}, { client, config: CONFIG_P1 }), re);
    assert.equal(runs.length, 0);
  }
});

test("--build-task-id on a template that is not deploy is refused", async () => {
  const { client, runs } = clientForOverrides({ id: 6, name: "Task", app: "ansible", type: "" });
  (client.tasks as unknown as Record<string, unknown>)["get"] = async (_p: number, id: number) => ({ id, template_id: 5, status: "success" });
  await assert.rejects(() => handleTasksRun(1, 6, { buildTaskId: 3 }, {}, { client, config: CONFIG_P1 }), /only applies to deploy templates/);
  assert.equal(runs.length, 0);
});

test("an unreadable template warns that a deploy would run without a version", async () => {
  const { client } = clientForOverrides(null);
  const err = captureErr();
  const cap = captureLog();
  try {
    await handleTasksRun(1, 6, {}, { json: true }, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
    err.restore();
  }
  assert.match(err.lines.join("\n"), /runs WITHOUT a version/);
});

test("listing the builds failing says what was being done, and nothing runs", async () => {
  const { client, runs } = clientForDeploy([]);
  (client.templates as unknown as Record<string, unknown>)["tasks"] = async () => { throw new Error("Semaphore API 400: Bad Request"); };
  await assert.rejects(() => handleTasksRun(1, 6, {}, {}, { client, config: CONFIG_P1 }), /listing the builds of template 5 to pick a version failed.*Nothing was run/);
  assert.equal(runs.length, 0);
});

test("an unreadable template that THROWS blocks the same flags as one that is not found", async () => {
  const flags = [{ tags: ["x"] }, { limit: "h1" }, { gitBranch: "dev" }, { arguments: '["--limit","h1"]' }, { playbook: "other.sh" }, { buildTaskId: 3 }];
  for (const opts of flags) {
    const { client, runs } = clientForOverrides(null);
    (client.templates as unknown as { get: () => Promise<never> }).get = async () => { throw new Error("502 Bad Gateway"); };
    await assert.rejects(
      () => handleTasksRun(1, 6, opts, {}, { client, config: CONFIG_P1 }),
      /needs to read template 6 .*reading it failed: 502 Bad Gateway\. Nothing was run\. Check the template id, or retry/,
    );
    assert.equal(runs.length, 0, JSON.stringify(opts));
  }
});

test("with several flags the refusal names them all, comma separated", async () => {
  const { client } = clientForOverrides(null);
  await assert.rejects(
    () => handleTasksRun(1, 6, { limit: "h1", tags: ["x"], playbook: "p.yml" }, {}, { client, config: CONFIG_P1 }),
    /--playbook, --limit, --tags need to read template 6/,
  );
});

test("--debug-level and --auto-approve still go through an unreadable template: dropped, they do no harm", async () => {
  for (const opts of [{ debug: true, debugLevel: 3 }, { autoApprove: true }]) {
    const { client, runs } = clientForOverrides(null);
    await runQuiet(client, opts);
    assert.equal(runs.length, 1, JSON.stringify(opts));
  }
});

test("every override that narrows or redirects the run fails closed when the template cannot be read", async () => {
  for (const opts of [{ inventoryId: 2 }, { skipTags: ["x"] }, { tags: ["x"] }, { limit: "h1" }, { gitBranch: "dev" }, { arguments: '["--limit","h1"]' }, { playbook: "other.sh" }, { buildTaskId: 3 }]) {
    const { client, runs } = clientForOverrides(null);
    await assert.rejects(() => handleTasksRun(1, 6, opts, {}, { client, config: CONFIG_P1 }), /needs to read template 6/);
    assert.equal(runs.length, 0);
  }
});

test("an inventory that cannot be checked blocks the run instead of risking the template's hosts", async () => {
  const { client, runs } = clientForOverrides({ id: 6, name: "D", app: "ansible", task_params: { allow_override_inventory: true } }, {
    inventory: { get: async () => { throw new Error("boom"); } },
  });
  await assert.rejects(() => handleTasksRun(1, 6, { inventoryId: 2 }, {}, { client, config: CONFIG_P1 }), /Could not check that inventory 2.*Nothing was run/);
  assert.equal(runs.length, 0);
});

test("tasks stop --force on a task the server does not return warns before forcing", async () => {
  const stops: unknown[] = [];
  const client = {
    tasks: { get: async () => null, stop: async (...a: unknown[]) => { stops.push(a); } },
  } as unknown as SemaphoreClient;
  const err = captureErr();
  const cap = captureLog();
  try {
    await handleTasksStop(1, 5, { force: true }, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
    err.restore();
  }
  assert.match(err.lines.join("\n"), /Could not read task 5: forcing the stop as asked/);
  assert.equal(stops.length, 1);
});

test("run --wait: a 404 on the very first read of the task it just created is lost contact, not 'not found'", async () => {
  const client = clientForWait(new SemaphoreApiError(404, "Task not found"));
  const err = captureErr();
  const cap = captureLog();
  try {
    await assert.rejects(() => handleTasksRun(1, 6, {}, { wait: true }, { client, config: CONFIG_P1 }), /Lost track of task 9.*may still be running/);
  } finally {
    cap.restore();
    err.restore();
  }
});

test("tasks wait on an id that does not exist still says not found", async () => {
  const client = clientForWait(new SemaphoreApiError(404, "Task not found"));
  await assert.rejects(() => handleTasksWait(1, 9, {}, { client, config: CONFIG_P1 }), (e: unknown) => e instanceof SemaphoreApiError && e.status === 404);
});

// Cambio deliberado (2026-09-27): con la plantilla ilegible --build-task-id ya
// falla cerrado antes de mirar la build, así que el estado de la build se prueba
// con una plantilla deploy legible.
test("--build-task-id: an unsuccessful build is refused", async () => {
  const { client, runs } = clientForOverrides({ id: 6, name: "D", app: "ansible", type: "deploy", build_template_id: 5 });
  (client.tasks as unknown as Record<string, unknown>)["get"] = async (_p: number, id: number) => ({ id, template_id: 5, status: "error" });
  await assert.rejects(() => handleTasksRun(1, 6, { buildTaskId: 3 }, {}, { client, config: CONFIG_P1 }), /ended error, not success/);
  assert.equal(runs.length, 0);
});

test("--build-task-id on a deploy template with no build template says so", async () => {
  const { client, runs } = clientForOverrides({ id: 6, name: "D", app: "ansible", type: "deploy" });
  (client.tasks as unknown as Record<string, unknown>)["get"] = async (_p: number, id: number) => ({ id, template_id: 5, status: "success" });
  await assert.rejects(() => handleTasksRun(1, 6, { buildTaskId: 3 }, {}, { client, config: CONFIG_P1 }), /has no build template/);
  assert.equal(runs.length, 0);
});

test("the legacy app \"\" counts as ansible for every check", async () => {
  const { client, runs } = clientForOverrides({ id: 6, name: "Legacy", app: "", task_params: { allow_override_limit: true } });
  await runQuiet(client, { limit: "h", dryRun: false, playbook: "x.yml" });
  assert.equal(runs.length, 1);
});

// — P14: /tasks ignora limit/start; la paginación real es /tasks/last —

test("tasks list --count/--before pages through tasks.last, with --status filtering inside the page", async () => {
  const calls: unknown[] = [];
  const client = {
    tasks: {
      list: async () => { throw new Error("list must not be used for paging"); },
      last: async (_p: number, o: unknown) => { calls.push(o); return [{ ...MOCK_TASK, id: 9, status: "error" }, { ...MOCK_TASK, id: 8, status: "success" }]; },
    },
  } as unknown as SemaphoreClient;
  const cap = captureLog();
  try {
    await handleTasksList(1, { json: true, count: 2, before: 10, status: "success" }, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
  }
  assert.deepEqual(calls[0], { limit: 2, before: 10 });
  assert.deepEqual((JSON.parse(cap.lines.join("\n")) as { id: number }[]).map((t) => t.id), [8]);
});

test("tasks list --count prints the next cursor on stderr, from the unfiltered page", async () => {
  const client = {
    tasks: { last: async () => [{ ...MOCK_TASK, id: 57, status: "success" }, { ...MOCK_TASK, id: 51, status: "success" }] },
  } as unknown as SemaphoreClient;
  const cap = captureLog();
  const err = captureErr();
  try {
    await handleTasksList(1, { json: true, count: 2, status: "error" }, { client, config: CONFIG_P1 });
  } finally {
    cap.restore();
    err.restore();
  }
  assert.deepEqual(JSON.parse(cap.lines.join("\n")), []);
  assert.deepEqual(err.lines, ["next page: --before 51"]);
});
