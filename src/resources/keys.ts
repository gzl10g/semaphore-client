import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type { Key, KeyType, KeySecret, CreateKeyInput, UpdateKeyInput, ObjectReferrers } from "../types.js";
import { mergeForUpdate, readForUpdate } from "./merge.js";

/**
 * Secret containers the GET returns empty (the material never leaves the
 * server). Echoing them back in an update would be sending an empty secret.
 */
const SECRET_FIELDS = ["ssh", "login_password", "string", "plain", "override_secret", "IgnorePlain"] as const;

/**
 * Builds the secret part of the body. The material does NOT travel in a
 * `secret` field — `AccessKey.Secret` is `json:"-"` in the server, so a body
 * like `{ secret: { private_key } }` is dropped by `encoding/json` and the key
 * is stored empty. It travels in the container that matches the type: `ssh`,
 * `login_password` or `string`.
 */
function secretBody(type: KeyType, secret: KeySecret | undefined): Record<string, unknown> {
  switch (type) {
    case "ssh":
      return {
        ssh: {
          login: secret?.login ?? "",
          passphrase: secret?.passphrase ?? "",
          private_key: secret?.privateKey ?? "",
        },
      };
    case "login_password":
      return { login_password: { login: secret?.login ?? "", password: secret?.password ?? "" } };
    case "string":
      return { string: secret?.string ?? "" };
    case "none":
      return {};
  }
}

export class KeysResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: number): Promise<Key[]> {
    return this.request<Key[]>(`/project/${projectId}/keys`);
  }

  async get(projectId: number, keyId: number): Promise<Key | null> {
    try {
      return await this.request<Key>(`/project/${projectId}/keys/${keyId}`);
    } catch (e) {
      if (e instanceof SemaphoreApiError && e.isNotFound) return null;
      throw e;
    }
  }

  async create(input: CreateKeyInput): Promise<Key> {
    return this.request<Key>(`/project/${input.projectId}/keys`, {
      method: "POST",
      body: {
        name: input.name,
        type: input.type,
        project_id: input.projectId,
        ...secretBody(input.type, input.secret),
      },
    });
  }

  /**
   * Partial update: reads the key and sends it back whole, because the server's
   * PUT is full-replace (see `merge.ts`).
   *
   * The secret is the exception, and it has its own rule. The GET never returns
   * the material (the server answers with empty `ssh`/`login_password`
   * containers), so those containers are dropped from the merge: leaving them
   * out is what makes the server keep the stored secret. And rewriting it
   * requires `override_secret: true` — without that flag the UPDATE only
   * touches `name` (`db/sql/access_key.go`), so both the secret and the type
   * would be ignored in silence.
   *
   * Which is why changing `type` requires passing the secret too: the new
   * material cannot be derived from the old key.
   */
  async update(projectId: number, keyId: number, input: UpdateKeyInput): Promise<void> {
    const existing = await readForUpdate<Key>(this.request, `/project/${projectId}/keys/${keyId}`, "Key", keyId);

    const type = input.type ?? (existing.type as KeyType);
    const rewritesSecret = input.secret !== undefined;

    if (input.type !== undefined && input.type !== existing.type && !rewritesSecret) {
      throw new SemaphoreApiError(
        0,
        `Key ${keyId}: changing the type to "${input.type}" requires the secret as well — the server only rewrites the type together with the material it stores.`,
        undefined,
        undefined,
        "PUT",
        `/project/${projectId}/keys/${keyId}`,
      );
    }

    // Retipar la clave de una integración autenticada la ABRE: todo auth method
    // lee el password de una login_password, y con otro tipo queda vacío
    // (medido en 2.19.12: tras `--type string`, un POST anónimo disparó la task).
    // `GET /keys/{id}/refs` no lista las integraciones que la usan (medido),
    // así que se miran las del proyecto. Solo cuando el tipo deja de ser login.
    if (input.type !== undefined && input.type !== existing.type && existing.type === "login_password") {
      const integrations = await this.request<{ id: number; name: string; auth_method: string; auth_secret_id?: number | null }[]>(
        `/project/${projectId}/integrations`,
      );
      const armed = (integrations ?? []).filter((i) => i.auth_secret_id === keyId && i.auth_method !== "");
      if (armed.length > 0) {
        throw new SemaphoreApiError(
          0,
          `Key ${keyId} holds the secret of integration${armed.length > 1 ? "s" : ""} ${armed.map((i) => `${i.id} ("${i.name}")`).join(", ")}: ` +
            `as a ${input.type} key its password would be empty and the webhook would accept forged requests. Point them at another login_password key first.`,
          undefined,
          undefined,
          "PUT",
          `/project/${projectId}/keys/${keyId}`,
        );
      }
    }

    await this.request(`/project/${projectId}/keys/${keyId}`, {
      method: "PUT",
      body: mergeForUpdate(
        existing,
        {
          id: keyId,
          project_id: projectId,
          name: input.name,
          type,
          ...(rewritesSecret && { ...secretBody(type, input.secret), override_secret: true }),
        },
        SECRET_FIELDS,
      ),
    });
  }

  /** What references it. Ask before deleting. */
  async refs(projectId: number, keyId: number): Promise<ObjectReferrers> {
    return this.request<ObjectReferrers>(`/project/${projectId}/keys/${keyId}/refs`);
  }

  async delete(projectId: number, keyId: number): Promise<void> {
    await this.request(`/project/${projectId}/keys/${keyId}`, { method: "DELETE" });
  }
}
