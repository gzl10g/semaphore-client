import { test } from "node:test";
import assert from "node:assert/strict";
import type { SemaphoreClient } from "../../src/client.js";
import { handleAppsGet, handleAppsSet, handleAppsDelete } from "../../src/cli/apps.js";
import { handleRolesUpdate, handleInstanceTasksList, handleInstanceTasksStop } from "../../src/cli/admin.js";

const CONFIG = { version: 1 as const, host: "http://x", token: "t", activeProject: 1 };

const POOL = [
  { task_id: 1, project_id: 2, status: "waiting", location: "queue" },
  { task_id: 2, project_id: 2, status: "running", location: "running" },
];

function buildDeps(opts: { app?: Record<string, unknown> | null; listFails?: boolean } = {}) {
  const calls: Record<string, unknown[]> = { appUpdate: [], roleUpdate: [], stop: [], appDelete: [] };
  const client = {
    apps: {
      get: async () => (opts.app === undefined ? { active: true, priority: 3, title: "T" } : opts.app),
      update: async (...a: unknown[]) => {
        calls["appUpdate"]?.push(a);
      },
      delete: async (...a: unknown[]) => {
        calls["appDelete"]?.push(a);
      },
    },
    roles: {
      update: async (...a: unknown[]) => {
        calls["roleUpdate"]?.push(a);
      },
    },
    instanceTasks: {
      list: async () => {
        if (opts.listFails === true) throw new Error("500 listing the pool");
        return POOL;
      },
      stop: async (...a: unknown[]) => {
        calls["stop"]?.push(a);
      },
    },
  } as unknown as SemaphoreClient;
  return { deps: { client, config: CONFIG }, calls };
}

/**
 * Captura stdout, no solo `console.log`: el contrato de `--json` es que la
 * salida ENTERA sea parseable, y un `process.stdout.write` suelto la rompe sin
 * que un espía de `console.log` se entere. `shared.ts` ya escribe a stdout
 * directamente en `flushStdout`, así que no es hipotético.
 */
function capture(): { out: string[]; restore: () => void } {
  const out: string[] = [];
  const originalLog = console.log;
  const originalWrite = process.stdout.write.bind(process.stdout);
  console.log = (...args: unknown[]) => out.push(args.map(String).join(" "));
  process.stdout.write = ((chunk: unknown) => {
    out.push(String(chunk).replace(/\n$/, ""));
    return true;
  }) as typeof process.stdout.write;
  return {
    out,
    restore: () => {
      console.log = originalLog;
      process.stdout.write = originalWrite;
    },
  };
}

// `GET /apps/{id}` does not echo the key back, so a caller piping several of
// them to jq could not tell which app it was looking at.
test("apps get vuelve a meter el id que el servidor no devuelve", async () => {
  const { deps } = buildDeps();
  const cap = capture();
  try {
    await handleAppsGet("ansible", { json: true }, deps);
  } finally {
    cap.restore();
  }
  assert.equal((JSON.parse(cap.out.join("\n")) as Record<string, unknown>)["id"], "ansible");
});

test("apps set distingue crear de actualizar", async () => {
  for (const [app, expected] of [
    [undefined, "App x updated"],
    [null, "App x created"],
  ] as const) {
    const { deps } = buildDeps(app === null ? { app: null } : {});
    const cap = capture();
    try {
      await handleAppsSet("x", { title: "T" }, { json: true }, deps);
    } finally {
      cap.restore();
    }
    const parsed = JSON.parse(cap.out.join("\n")) as Record<string, unknown>;
    assert.equal(parsed["message"], expected);
    assert.equal(parsed["ok"], true);
  }
});

test("roles update respeta el contrato --json", async () => {
  const { deps } = buildDeps();
  const cap = capture();
  try {
    await handleRolesUpdate("deployer", { name: "N" }, { json: true }, deps);
  } finally {
    cap.restore();
  }
  const parsed = JSON.parse(cap.out.join("\n")) as Record<string, unknown>;
  assert.equal(parsed["ok"], true);
  assert.equal(parsed["slug"], "deployer");
});

test("instance tasks filtra por donde está la task", async () => {
  for (const [flag, expected] of [
    [{ queued: true }, [1]],
    [{ running: true }, [2]],
    [{}, [1, 2]],
  ] as const) {
    const { deps } = buildDeps();
    const cap = capture();
    try {
      await handleInstanceTasksList({ json: true, ...flag }, deps);
    } finally {
      cap.restore();
    }
    const parsed = JSON.parse(cap.out.join("\n")) as { task_id: number }[];
    assert.deepEqual(parsed.map((t) => t.task_id), expected);
  }
});

// El servidor responde 204 esté o no la task en el pool, así que un 204 no es
// prueba de que se haya parado nada: el mensaje dice lo que de verdad pasó.
test("instance stop no presume de haber parado algo que no estaba", async () => {
  for (const [id, stopped] of [[2, true], [999, false]] as const) {
    const { deps, calls } = buildDeps();
    const cap = capture();
    try {
      await handleInstanceTasksStop(id, { json: true }, deps);
    } finally {
      cap.restore();
    }
    const parsed = JSON.parse(cap.out.join("\n")) as Record<string, unknown>;
    assert.equal(parsed["stopped"], stopped);
    assert.match(String(parsed["message"]), stopped ? /stopped/ : /was not queued or running/);
    assert.deepEqual(calls["stop"], [[id]]);
  }
});

// Encadenar los dos filtros devolvía [] con exit 0: "no hay nada corriendo"
// con el pool lleno es peor que un error.
test("instance tasks rechaza --queued y --running juntos en vez de mentir", async () => {
  const { deps } = buildDeps();
  await assert.rejects(
    () => handleInstanceTasksList({ json: true, queued: true, running: true }, deps),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mutually exclusive/);
      return true;
    },
  );
});

// La lectura previa solo sirve para redactar el mensaje: si falla, la parada
// tiene que salir igual. Corriéndola antes y dejándola lanzar, un 500 en
// GET /tasks cancelaba el DELETE y la task seguía corriendo.
test("si la comprobación previa falla, el stop se envía igual", async () => {
  const { deps, calls } = buildDeps({ listFails: true });
  const cap = capture();
  try {
    await handleInstanceTasksStop(2, { json: true }, deps);
  } finally {
    cap.restore();
  }
  assert.deepEqual(calls["stop"], [[2]]);
  const parsed = JSON.parse(cap.out.join("\n")) as Record<string, unknown>;
  assert.equal(parsed["stopped"], null);
  assert.match(String(parsed["message"]), /could not check/);
});

// La rama de tabla es la salida por defecto: la que ve una persona. Todos los
// casos de arriba pasan --json, así que ROLES_COLUMNS y POOL_COLUMNS no se
// renderizaban nunca y un error en una clave de columna pasaba en verde.
test("la salida de tabla se renderiza, incluida la columna que dice dónde está la task", async () => {
  const { deps } = buildDeps();
  const cap = capture();
  try {
    await handleInstanceTasksList({ json: false }, deps);
  } finally {
    cap.restore();
  }
  const out = cap.out.join("\n");
  assert.match(out, /Where/);
  assert.match(out, /queue/);
  assert.match(out, /running/);
});

test("apps get en tabla no revienta con los campos nulos que trae una app", async () => {
  const { deps } = buildDeps({ app: { active: true, priority: 3, title: "T", args: null, path: "" } });
  const cap = capture();
  try {
    await handleAppsGet("ansible", { json: false }, deps);
  } finally {
    cap.restore();
  }
  assert.match(cap.out.join("\n"), /id: ansible/);
});

// Si alguien invierte el check de reportMutation, los tests con --json siguen
// pasando y solo se entera quien NO usa --json.
test("sin --json la mutación imprime la frase, no el JSON", async () => {
  const { deps } = buildDeps();
  const cap = capture();
  try {
    await handleRolesUpdate("deployer", { name: "N" }, { json: false }, deps);
  } finally {
    cap.restore();
  }
  assert.equal(cap.out.join("\n"), "Role deployer updated");
});

test("un get que no encuentra nada lanza en vez de imprimir null", async () => {
  const { deps } = buildDeps({ app: null });
  const cap = capture();
  try {
    await assert.rejects(
      () => handleAppsGet("ghost", { json: true }, deps),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /not found/);
        return true;
      },
    );
  } finally {
    cap.restore();
  }
  assert.equal(cap.out.join("\n"), "");
});

// Borrar una app es instance-wide y deja a las plantillas apuntando a algo que
// el servidor ya no conoce: invertir el gate del --yes es caro en los dos
// sentidos (bloquea CI, o borra sin preguntar).
test("apps delete --yes borra sin preguntar y dice qué borró", async () => {
  const { deps, calls } = buildDeps();
  const cap = capture();
  try {
    await handleAppsDelete("custom", { yes: true }, deps);
  } finally {
    cap.restore();
  }
  assert.deepEqual(calls["appDelete"], [["custom"]]);
  assert.match(cap.out.join("\n"), /App custom deleted/);
});
