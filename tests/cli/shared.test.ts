import { test } from "node:test";
import assert from "node:assert/strict";
import { SemaphoreApiError } from "../../src/error.js";
import {
  resolveProject,
  buildClient,
  formatTable,
  formatErrorJson,
  parseIntOption,
} from "../../src/cli/shared.js";
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

// — NODE_ENV=development no habla con un Semaphore compartido —

test("en development, un host remoto se rechaza nombrando la alternativa", () => {
  const prevEnv = process.env["NODE_ENV"];
  const prevAllow = process.env["SMPHE_ALLOW_REMOTE"];
  process.env["NODE_ENV"] = "development";
  delete process.env["SMPHE_ALLOW_REMOTE"];
  try {
    assert.throws(
      () => buildClient({ version: 1, host: "https://semaphore.int.example.com", token: "t" }),
      (e: unknown) => e instanceof Error && /semaphore-test-instance/.test(e.message),
    );
  } finally {
    if (prevEnv === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = prevEnv;
    if (prevAllow !== undefined) process.env["SMPHE_ALLOW_REMOTE"] = prevAllow;
  }
});

test("en development, el contenedor de Docker sí se acepta", () => {
  const prevEnv = process.env["NODE_ENV"];
  process.env["NODE_ENV"] = "development";
  try {
    for (const host of ["http://localhost:3000", "http://127.0.0.1:3000", "http://host.docker.internal:3000"]) {
      assert.doesNotThrow(() => buildClient({ version: 1, host, token: "t" }), `debe aceptar ${host}`);
    }
  } finally {
    if (prevEnv === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = prevEnv;
  }
});

test("SMPHE_ALLOW_REMOTE=1 es la puerta de salida, y hay que teclearla a propósito", () => {
  const prevEnv = process.env["NODE_ENV"];
  const prevAllow = process.env["SMPHE_ALLOW_REMOTE"];
  process.env["NODE_ENV"] = "development";
  process.env["SMPHE_ALLOW_REMOTE"] = "1";
  try {
    assert.doesNotThrow(() => buildClient({ version: 1, host: "https://semaphore.int.example.com", token: "t" }));
  } finally {
    if (prevEnv === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = prevEnv;
    if (prevAllow === undefined) delete process.env["SMPHE_ALLOW_REMOTE"]; else process.env["SMPHE_ALLOW_REMOTE"] = prevAllow;
  }
});

test("sin NODE_ENV=development, el guard no se mete en medio", () => {
  const prevEnv = process.env["NODE_ENV"];
  delete process.env["NODE_ENV"];
  try {
    assert.doesNotThrow(() => buildClient({ version: 1, host: "https://semaphore.int.example.com", token: "t" }));
  } finally {
    if (prevEnv !== undefined) process.env["NODE_ENV"] = prevEnv;
  }
});

test("en development, [::1] también es local (new URL lo devuelve con corchetes)", () => {
  const prev = process.env["NODE_ENV"];
  process.env["NODE_ENV"] = "development";
  try {
    assert.doesNotThrow(() => buildClient({ version: 1, host: "http://[::1]:3010", token: "t" }));
  } finally {
    if (prev === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = prev;
  }
});

test("una URL sin esquema se distingue de un host remoto", () => {
  const prev = process.env["NODE_ENV"];
  process.env["NODE_ENV"] = "development";
  try {
    assert.throws(
      () => buildClient({ version: 1, host: "localhost:3010", token: "t" }),
      (e: unknown) => e instanceof Error && /not a usable URL/.test(e.message),
      "decir 'apúntalo a localhost' cuando ya lo has apuntado ahí desorienta",
    );
  } finally {
    if (prev === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = prev;
  }
});

// — forma del JSON de error: lo que un consumidor va a parsear —

test("un error de la API lleva status, método y endpoint", () => {
  const err = new SemaphoreApiError(404, "Not Found", undefined, "Template 9 not found", "GET", "/project/1/templates/9");
  const parsed = JSON.parse(formatErrorJson(err, null)) as { error: Record<string, unknown> };

  assert.equal(parsed.error["status"], 404);
  assert.equal(parsed.error["method"], "GET");
  assert.equal(parsed.error["endpoint"], "/project/1/templates/9");
  assert.match(String(parsed.error["message"]), /Template 9 not found/);
});

test("un error local NO inventa status: haría creer que respondió el servidor", () => {
  const parsed = JSON.parse(formatErrorJson(new Error("--arguments must be a JSON list"), null)) as {
    error: Record<string, unknown>;
  };

  assert.equal(parsed.error["message"], "--arguments must be a JSON list");
  assert.ok(!("status" in parsed.error), "sin status");
  assert.ok(!("method" in parsed.error), "sin method");
  assert.ok(!("endpoint" in parsed.error), "sin endpoint");
});

test("el error de la API sin método ni endpoint no los inventa tampoco", () => {
  const parsed = JSON.parse(formatErrorJson(new SemaphoreApiError(500, "Internal"), null)) as {
    error: Record<string, unknown>;
  };
  assert.equal(parsed.error["status"], 500);
  assert.ok(!("method" in parsed.error));
});

test("la pista de permisos viaja en el JSON, y una pista vacía no ensucia la salida", () => {
  const err = new SemaphoreApiError(403, "Forbidden", undefined, undefined, "PUT", "/project/1/templates/9");
  const conPista = JSON.parse(formatErrorJson(err, "your role is task_runner")) as { error: Record<string, unknown> };
  assert.equal(conPista.error["hint"], "your role is task_runner");

  const sinPista = JSON.parse(formatErrorJson(err, "")) as { error: Record<string, unknown> };
  assert.ok(!("hint" in sinPista.error), "una pista vacía no debe aparecer como hint: \"\"");
});

// Es el parser de TODOS los flags numéricos del CLI, no solo de los míos, y lo
// reescribí sin un solo test: una mutación que desactivara la validación
// entera pasaba en verde.
test("parseIntOption acepta un entero y lo devuelve como número", () => {
  assert.equal(parseIntOption("12"), 12);
  assert.equal(parseIntOption(" 12 "), 12);
  assert.equal(parseIntOption("-3"), -3);
});

// Ceros a la izquierda: `--project 007` funcionaba con el parseInt de antes y
// no tiene nada de ambiguo. Rechazarlo sería un rechazo NUEVO en comandos que
// ya existían, así que se acepta a propósito.
test("parseIntOption sigue aceptando ceros a la izquierda", () => {
  assert.equal(parseIntOption("007"), 7);
  assert.equal(parseIntOption("0"), 0);
});

// Lo que parseInt aceptaba truncando en silencio, y lo que daba NaN. Un NaN no
// es undefined: sobrevive al merge y sale al wire como null, que es como un
// typo en --auth-secret-id desenganchaba una credencial.
test("parseIntOption rechaza lo que parseInt aceptaba a medias", () => {
  for (const bad of ["abc", "1e3", "3.5", "", "   ", "12abc", "0x10", "1,2"]) {
    assert.throws(() => parseIntOption(bad), /expected an integer/, `debería rechazar ${JSON.stringify(bad)}`);
  }
});
