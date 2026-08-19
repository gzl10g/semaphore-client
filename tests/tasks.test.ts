import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { TasksResource } from "../src/resources/tasks.js";
import { SemaphoreApiError } from "../src/error.js";
import type { Task } from "../src/types.js";

function makeRequestFn(status: number, body: string) {
  return async () => {
    const res = { ok: false, status, statusText: "Bad Request", text: async () => body, json: async () => ({}) };
    throw new SemaphoreApiError(status, res.statusText, undefined, body);
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    template_id: 10,
    project_id: 1,
    status: "success",
    debug: false,
    dry_run: false,
    created: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// Helper: resource con request que nunca se llama (para tests que mockean get directamente)
function makeResource(): TasksResource {
  return new TasksResource(() => { throw new Error("request not mocked"); });
}

// — waitForCompletion —

test("waitForCompletion resuelve cuando status es success", async () => {
  const tm = mock.method(globalThis, "setTimeout", (fn: TimerHandler) => {
    if (typeof fn === "function") fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });

  const resource = makeResource();
  let call = 0;
  mock.method(resource, "get", async () => {
    return makeTask({ status: call++ === 0 ? "running" : "success" });
  });

  const result = await resource.waitForCompletion(1, 1);
  assert.equal(result.status, "success");

  tm.mock.restore();
});

test("waitForCompletion resuelve con status error", async () => {
  const tm = mock.method(globalThis, "setTimeout", (fn: TimerHandler) => {
    if (typeof fn === "function") fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });

  const resource = makeResource();
  let call = 0;
  mock.method(resource, "get", async () => {
    return makeTask({ status: call++ === 0 ? "running" : "error" });
  });

  const result = await resource.waitForCompletion(1, 1);
  assert.equal(result.status, "error");

  tm.mock.restore();
});

test("waitForCompletion resuelve con status stopped", async () => {
  const tm = mock.method(globalThis, "setTimeout", (fn: TimerHandler) => {
    if (typeof fn === "function") fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });

  const resource = makeResource();
  let call = 0;
  mock.method(resource, "get", async () => {
    return makeTask({ status: call++ === 0 ? "running" : "stopped" });
  });

  const result = await resource.waitForCompletion(1, 1);
  assert.equal(result.status, "stopped");

  tm.mock.restore();
});

test("waitForCompletion lanza SemaphoreApiError si timeout se alcanza", async () => {
  const tm = mock.method(globalThis, "setTimeout", (fn: TimerHandler) => {
    if (typeof fn === "function") fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });

  const resource = makeResource();
  // get() siempre devuelve "running"; el timeout se alcanza en la segunda iteración
  // porque timeout:0 hace que Date.now() - start > 0 tras el primer poll
  mock.method(resource, "get", async () => makeTask({ status: "running" }));

  await assert.rejects(
    () => resource.waitForCompletion(1, 1, { timeout: 0 }),
    (err: unknown) => {
      assert.ok(err instanceof SemaphoreApiError);
      assert.ok(err.message.includes("Timeout"));
      return true;
    },
  );

  tm.mock.restore();
});

test("waitForCompletion lanza si signal está abortado", async () => {
  const resource = makeResource();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => resource.waitForCompletion(1, 1, { signal: controller.signal }),
    SemaphoreApiError,
  );
});

// — get() quirk 400 —

test("get devuelve null cuando Semaphore devuelve 400 con 'Invalid task id'", async () => {
  const resource = new TasksResource(makeRequestFn(400, "Invalid task id"));
  const result = await resource.get(1, 99);
  assert.equal(result, null);
});

test("get lanza SemaphoreApiError cuando 400 tiene body diferente", async () => {
  const resource = new TasksResource(makeRequestFn(400, "validation error: bad payload"));
  await assert.rejects(() => resource.get(1, 99), (err: unknown) => {
    assert.ok(err instanceof SemaphoreApiError);
    assert.equal(err.status, 400);
    return true;
  });
});

test("waitForCompletion lanza SemaphoreApiError 404 si task no existe", async () => {
  const resource = makeResource();
  mock.method(resource, "get", async () => null);

  await assert.rejects(
    () => resource.waitForCompletion(1, 1),
    (err: unknown) => {
      assert.ok(err instanceof SemaphoreApiError);
      assert.equal(err.status, 404);
      return true;
    },
  );
});
