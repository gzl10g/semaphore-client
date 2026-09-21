import { loadConfig, saveConfig, mergeConfig, configFilePath } from "./config.js";
import type { HandlerDeps } from "./shared.js";

const VALID_KEYS = ["host", "token"] as const;
type ValidKey = (typeof VALID_KEYS)[number];

function isValidKey(key: string): key is ValidKey {
  return (VALID_KEYS as readonly string[]).includes(key);
}

function maskToken(token: string): string {
  if (token.length <= 4) {
    return "****";
  }
  return `****${token.slice(-4)}`;
}

export async function handleConfigSet(
  key: string,
  value: string,
  deps?: HandlerDeps,
): Promise<void> {
  if (!isValidKey(key)) {
    throw new Error(
      `Clave invalida: "${key}". Claves validas: ${VALID_KEYS.join(", ")}`,
    );
  }

  const config = loadConfig({ homeDir: deps?.homeDir });
  const updated = mergeConfig(config, { [key]: value });
  saveConfig(updated, { homeDir: deps?.homeDir });
  console.log(`${key} guardado`);
}

/**
 * De dónde sale cada valor, no solo cuál es.
 *
 * El entorno gana al fichero (como `SMPHE_PROJECT` ya hacía, y como hace
 * cualquier CLI), y eso es lo que permite apuntar a otra instancia sin editar
 * `$HOME`. El peligro no es la precedencia: es que sea invisible —un `export`
 * olvidado redirigiendo comandos en silencio—, así que se dice.
 */
function describeSource(...envVars: string[]): string {
  // En orden de precedencia real: gana la primera que esté puesta.
  const winner = envVars.find((v) => process.env[v] !== undefined && process.env[v] !== "");
  return winner !== undefined ? ` (from ${winner})` : "";
}

export async function handleConfigShow(deps?: HandlerDeps): Promise<void> {
  const config = loadConfig({ homeDir: deps?.homeDir });

  const host = config.host ?? "(no configurado)";
  const token = config.token ? maskToken(config.token) : "(no configurado)";
  // SMPHE_PROJECT lo resuelve `resolveProject` en cada comando, no `loadConfig`:
  // sin esto, `config show` decia "(no configurado) (from SMPHE_PROJECT)", que
  // es lo contrario de lo que pasa al operar.
  const envProject = process.env["SMPHE_PROJECT"];
  const activeProject =
    envProject !== undefined && envProject !== ""
      ? envProject
      : config.activeProject ?? "(no configurado)";

  console.log(`host:          ${host}${describeSource("SMPHE_HOST")}`);
  // SMPHE_TOKEN_FILE gana a SMPHE_TOKEN, así que la atribución tiene que seguir
  // ese orden: decir "from SMPHE_TOKEN" cuando manda el fichero es mentir.
  console.log(`token:         ${token}${describeSource("SMPHE_TOKEN_FILE", "SMPHE_TOKEN")}`);
  console.log(`activeProject: ${activeProject}${describeSource("SMPHE_PROJECT")}`);
  console.log(`file:          ${configFilePath(deps?.homeDir)}`);

  const overridden = ["SMPHE_HOST", "SMPHE_TOKEN_FILE", "SMPHE_TOKEN", "SMPHE_PROJECT"].filter(
    (v) => process.env[v] !== undefined && process.env[v] !== "",
  );
  if (overridden.length > 0) {
    console.log("");
    console.log(`note: ${overridden.join(", ")} override ${configFilePath(deps?.homeDir)} in this shell.`);
  }
}

/** Lee el token de stdin, sin dejarlo en el historial ni en `ps`. */
async function readTokenFromStdin(): Promise<string> {
  // Sin tubería, el for-await se queda esperando para siempre y sin decir nada:
  // el usuario que teclea `smphe login --token-stdin` —lo que recomiendan el
  // --help, el README y llms.txt— se encuentra un cuelgue mudo.
  if (process.stdin.isTTY === true) {
    throw new Error(
      "--token-stdin expects the token on a pipe: echo \"$TOKEN\" | smphe login --token-stdin",
    );
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const token = Buffer.concat(chunks).toString("utf8").trim();
  if (token === "") {
    throw new Error("--token-stdin was given but stdin was empty");
  }
  return token;
}

export async function handleLoginToken(
  input: { token?: string; tokenStdin?: boolean },
  deps?: HandlerDeps,
): Promise<void> {
  if (input.token !== undefined && input.tokenStdin === true) {
    throw new Error("--token and --token-stdin are mutually exclusive");
  }

  let token: string;
  if (input.tokenStdin === true) {
    token = await readTokenFromStdin();
  } else if (input.token !== undefined) {
    // Un token en argv queda en el historial del shell y es visible en `ps`
    // para cualquier proceso de la máquina mientras dura el comando.
    console.error(
      "warning: --token leaves the token in your shell history and in `ps`. " +
        "Prefer: echo \"$TOKEN\" | smphe login --token-stdin",
    );
    token = input.token;
  } else {
    throw new Error("provide the token with --token-stdin (preferred) or --token");
  }

  const config = loadConfig({ homeDir: deps?.homeDir });
  const updated = mergeConfig(config, { token });
  saveConfig(updated, { homeDir: deps?.homeDir });
  console.log("Token guardado correctamente");
}

export async function handleUseProject(
  id: number,
  deps?: HandlerDeps,
): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(
      `ID de proyecto invalido: ${id}. Debe ser un entero positivo`,
    );
  }

  const config = loadConfig({ homeDir: deps?.homeDir });
  const updated = mergeConfig(config, { activeProject: id });
  saveConfig(updated, { homeDir: deps?.homeDir });
  console.log(`Proyecto activo: ${id}`);
}
