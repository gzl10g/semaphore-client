import { loadConfig, saveConfig, mergeConfig } from "./config.js";
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

export async function handleConfigShow(deps?: HandlerDeps): Promise<void> {
  const config = loadConfig({ homeDir: deps?.homeDir });

  const host = config.host ?? "(no configurado)";
  const token = config.token ? maskToken(config.token) : "(no configurado)";
  const activeProject = config.activeProject ?? "(no configurado)";

  console.log(`host:          ${host}`);
  console.log(`token:         ${token}`);
  console.log(`activeProject: ${activeProject}`);
}

export async function handleLoginToken(
  token: string,
  deps?: HandlerDeps,
): Promise<void> {
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
