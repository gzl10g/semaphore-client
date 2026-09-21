import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type {
  IntegrationAuthMethod,
  Integration,
  CreateIntegrationInput,
  UpdateIntegrationInput,
  IntegrationMatcher,
  CreateIntegrationMatcherInput,
  UpdateIntegrationMatcherInput,
  IntegrationExtractValue,
  CreateIntegrationExtractValueInput,
  UpdateIntegrationExtractValueInput,
  IntegrationAlias,
  IntegrationRefs,
  IntegrationChildRefs,
} from "../types.js";
import { mergeForUpdate, readForUpdate } from "./merge.js";

/**
 * An auth method needs a key holding its shared secret. Without one the server
 * stores the method happily and then compares every incoming request against an
 * empty password, so the webhook goes quiet: `ReceiveIntegration` logs and
 * `continue`s, and the caller still gets 204. Nothing anywhere says the
 * integration is dead.
 *
 * Guarded in the resource rather than in the CLI so that importing this package
 * cannot reach that state either — same place `KeysResource.update` guards the
 * equivalent trap for keys.
 */
function assertAuthIsUsable(
  authMethod: IntegrationAuthMethod,
  authSecretId: number | null | undefined,
  endpoint: string,
  method: "POST" | "PUT",
): void {
  if (authMethod === "" || (authSecretId !== null && authSecretId !== undefined && authSecretId !== 0)) {
    return;
  }
  throw new SemaphoreApiError(
    0,
    `Integration auth method "${authMethod}" needs a key holding its secret (auth_secret_id): without one the server accepts the request and then drops every webhook call in silence.`,
    undefined,
    undefined,
    method,
    endpoint,
  );
}

/**
 * Integrations: webhook entry points that run a template.
 *
 * An integration is reached through an *alias* (`POST /api/integrations/{alias}`),
 * its *matchers* decide whether an incoming request fires it, and its *extract
 * values* copy parts of the request into the task.
 *
 * As everywhere else in this API, PUT is a full replace: `UpdateIntegration`
 * binds a zero-valued struct and persists it. Verified on 2.19.8 by renaming an
 * integration with a hand-made partial body: `{id, project_id, name}` answers
 * **400 with an empty body** (the zeroed `template_id` fails), and adding
 * `template_id` answers **204** having silently cleared `auth_method`,
 * `auth_secret_id` and `auth_header` — an authenticated webhook turned into an
 * open one, with no error anywhere. Every `update()` here reads first and
 * merges (`./merge.ts`).
 */
export class IntegrationsResource {
  readonly matchers: IntegrationMatchersResource;
  readonly values: IntegrationExtractValuesResource;
  readonly aliases: IntegrationAliasesResource;

  constructor(private readonly request: RequestFn) {
    this.matchers = new IntegrationMatchersResource(request);
    this.values = new IntegrationExtractValuesResource(request);
    this.aliases = new IntegrationAliasesResource(request);
  }

  async list(projectId: number): Promise<Integration[]> {
    return this.request<Integration[]>(`/project/${projectId}/integrations`);
  }

  async get(projectId: number, integrationId: number): Promise<Integration | null> {
    try {
      return await this.request<Integration>(
        `/project/${projectId}/integrations/${integrationId}`,
      );
    } catch (e) {
      if (e instanceof SemaphoreApiError && e.isNotFound) return null;
      throw e;
    }
  }

  /**
   * The server checks `project_id` in the body against the URL and rejects a
   * mismatch with 400, so it is always sent from `input.projectId`.
   */
  async create(input: CreateIntegrationInput): Promise<Integration> {
    const endpoint = `/project/${input.projectId}/integrations`;
    assertAuthIsUsable(input.authMethod ?? "", input.authSecretId, endpoint, "POST");

    return this.request<Integration>(endpoint, {
      method: "POST",
      body: {
        project_id: input.projectId,
        name: input.name,
        template_id: input.templateId,
        auth_method: input.authMethod ?? "",
        auth_header: input.authHeader ?? "",
        ...(input.authSecretId !== undefined && { auth_secret_id: input.authSecretId }),
        ...(input.searchable !== undefined && { searchable: input.searchable }),
        ...(input.taskParams !== undefined && { task_params: input.taskParams }),
      },
    });
  }

  /** Partial update: reads the integration and re-sends it whole. Answers 204. */
  async update(
    projectId: number,
    integrationId: number,
    input: UpdateIntegrationInput,
  ): Promise<void> {
    const endpoint = `/project/${projectId}/integrations/${integrationId}`;
    const existing = await readForUpdate<Integration>(
      this.request,
      endpoint,
      "Integration",
      integrationId,
    );

    // The merge decides the stored state, so the check has to run on it and not
    // on the input: `update(id, {authMethod: "hmac"})` over an integration that
    // never had a key arms a method with no secret.
    assertAuthIsUsable(
      input.authMethod ?? existing.auth_method ?? "",
      input.authSecretId === undefined ? existing.auth_secret_id : input.authSecretId,
      endpoint,
      "PUT",
    );

    await this.request(endpoint, {
      method: "PUT",
      body: mergeForUpdate(existing, {
        // Both ids are validated against the URL; the GET already carries them,
        // but a server that ever omits one would turn the PUT into a 400.
        id: integrationId,
        project_id: projectId,
        name: input.name,
        template_id: input.templateId,
        auth_method: input.authMethod,
        auth_secret_id: input.authSecretId,
        auth_header: input.authHeader,
        searchable: input.searchable,
        task_params: input.taskParams,
      }),
    });
  }

  async delete(projectId: number, integrationId: number): Promise<void> {
    await this.request(`/project/${projectId}/integrations/${integrationId}`, {
      method: "DELETE",
    });
  }

  /**
   * Kept because the endpoint exists, but on 2.19.8 it answers
   * `{matchers: null, values: null}` for every integration: the store method
   * is a stub with its body commented out. To see what an integration is made
   * of, list its matchers and values. Verified against 2.19.8.
   */
  async refs(projectId: number, integrationId: number): Promise<IntegrationRefs> {
    return this.request<IntegrationRefs>(
      `/project/${projectId}/integrations/${integrationId}/refs`,
    );
  }
}

export class IntegrationMatchersResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: number, integrationId: number): Promise<IntegrationMatcher[]> {
    return this.request<IntegrationMatcher[]>(
      `/project/${projectId}/integrations/${integrationId}/matchers`,
    );
  }

  async get(
    projectId: number,
    integrationId: number,
    matcherId: number,
  ): Promise<IntegrationMatcher | null> {
    try {
      return await this.request<IntegrationMatcher>(
        `/project/${projectId}/integrations/${integrationId}/matchers/${matcherId}`,
      );
    } catch (e) {
      if (e instanceof SemaphoreApiError && e.isNotFound) return null;
      throw e;
    }
  }

  /**
   * `integration_id` in the body must match the URL (400 otherwise), and the
   * server validates name, match_type, key and value.
   */
  async create(
    projectId: number,
    integrationId: number,
    input: CreateIntegrationMatcherInput,
  ): Promise<IntegrationMatcher> {
    return this.request<IntegrationMatcher>(
      `/project/${projectId}/integrations/${integrationId}/matchers`,
      {
        method: "POST",
        body: {
          integration_id: integrationId,
          name: input.name,
          match_type: input.matchType,
          method: input.method,
          key: input.key,
          value: input.value,
          body_data_type: input.bodyDataType ?? (input.matchType === "body" ? "json" : ""),
        },
      },
    );
  }

  /**
   * Partial update through read-merge-write.
   *
   * `UpdateIntegrationMatcher` binds into a zero struct *and* takes the row to
   * update from `matcher.ID` in the body — it never compares it with the URL.
   * So a body without `id` does not update the matcher in the URL: it writes to
   * id 0 and still answers 204.
   */
  async update(
    projectId: number,
    integrationId: number,
    matcherId: number,
    input: UpdateIntegrationMatcherInput,
  ): Promise<void> {
    const endpoint = `/project/${projectId}/integrations/${integrationId}/matchers/${matcherId}`;
    const existing = await readForUpdate<IntegrationMatcher>(
      this.request,
      endpoint,
      "Integration matcher",
      matcherId,
    );

    await this.request(endpoint, {
      method: "PUT",
      body: mergeForUpdate(existing, {
        id: matcherId,
        integration_id: integrationId,
        name: input.name,
        match_type: input.matchType,
        method: input.method,
        key: input.key,
        value: input.value,
        body_data_type: input.bodyDataType,
      }),
    });
  }

  async delete(projectId: number, integrationId: number, matcherId: number): Promise<void> {
    await this.request(
      `/project/${projectId}/integrations/${integrationId}/matchers/${matcherId}`,
      { method: "DELETE" },
    );
  }

  /** The integration this matcher belongs to. */
  async refs(
    projectId: number,
    integrationId: number,
    matcherId: number,
  ): Promise<IntegrationChildRefs> {
    return this.request<IntegrationChildRefs>(
      `/project/${projectId}/integrations/${integrationId}/matchers/${matcherId}/refs`,
    );
  }
}

export class IntegrationExtractValuesResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: number, integrationId: number): Promise<IntegrationExtractValue[]> {
    return this.request<IntegrationExtractValue[]>(
      `/project/${projectId}/integrations/${integrationId}/values`,
    );
  }

  async get(
    projectId: number,
    integrationId: number,
    valueId: number,
  ): Promise<IntegrationExtractValue | null> {
    try {
      return await this.request<IntegrationExtractValue>(
        `/project/${projectId}/integrations/${integrationId}/values/${valueId}`,
      );
    } catch (e) {
      if (e instanceof SemaphoreApiError && e.isNotFound) return null;
      throw e;
    }
  }

  async create(
    projectId: number,
    integrationId: number,
    input: CreateIntegrationExtractValueInput,
  ): Promise<IntegrationExtractValue> {
    return this.request<IntegrationExtractValue>(
      `/project/${projectId}/integrations/${integrationId}/values`,
      {
        method: "POST",
        body: {
          integration_id: integrationId,
          name: input.name,
          value_source: input.valueSource,
          body_data_type:
            input.bodyDataType ?? (input.valueSource === "body" ? "json" : ""),
          key: input.key ?? "",
          variable: input.variable,
          variable_type: input.variableType,
        },
      },
    );
  }

  /**
   * Partial update. This one handler does load the row before binding, so the
   * server would merge on its own — but it is the only PUT in the API that
   * does, and relying on that would make this resource the odd one out the day
   * it stops. Read-merge-write keeps the behaviour the same as everywhere else.
   */
  async update(
    projectId: number,
    integrationId: number,
    valueId: number,
    input: UpdateIntegrationExtractValueInput,
  ): Promise<void> {
    const endpoint = `/project/${projectId}/integrations/${integrationId}/values/${valueId}`;
    const existing = await readForUpdate<IntegrationExtractValue>(
      this.request,
      endpoint,
      "Integration extract value",
      valueId,
    );

    await this.request(endpoint, {
      method: "PUT",
      body: mergeForUpdate(existing, {
        id: valueId,
        integration_id: integrationId,
        name: input.name,
        value_source: input.valueSource,
        body_data_type: input.bodyDataType,
        key: input.key,
        variable: input.variable,
        variable_type: input.variableType,
      }),
    });
  }

  async delete(projectId: number, integrationId: number, valueId: number): Promise<void> {
    await this.request(`/project/${projectId}/integrations/${integrationId}/values/${valueId}`, {
      method: "DELETE",
    });
  }

  async refs(
    projectId: number,
    integrationId: number,
    valueId: number,
  ): Promise<IntegrationChildRefs> {
    return this.request<IntegrationChildRefs>(
      `/project/${projectId}/integrations/${integrationId}/values/${valueId}/refs`,
    );
  }
}

/**
 * Aliases: the public URLs that fire an integration.
 *
 * Two levels share one handler. With an `integrationId` the alias belongs to
 * that integration; without it the alias is project-wide.
 *
 * Which level works is decided by the integration's `searchable` flag, and the
 * two are mutually exclusive (`GetIntegrationsByAlias`, `db/sql/integration_alias.go`):
 *
 * - `searchable: false` — only its own alias fires it, and the matchers are
 *   **not evaluated at all** (`ReceiveIntegration` skips them for a single-level
 *   alias). The alias is the whole authorization.
 * - `searchable: true` — its own alias answers as if it did not exist, and it is
 *   reached only through the project alias, which offers the request to every
 *   searchable integration and runs the ones whose matchers *all* match. An
 *   integration with no matchers never fires this way.
 */
export class IntegrationAliasesResource {
  constructor(private readonly request: RequestFn) {}

  private endpoint(projectId: number, integrationId?: number): string {
    return integrationId === undefined
      ? `/project/${projectId}/integrations/aliases`
      : `/project/${projectId}/integrations/${integrationId}/aliases`;
  }

  /**
   * The server answers `{id, url}`; the alias itself is the last segment of the
   * URL, so it is filled in here. `url` is built from the server's `web_host`
   * setting, so on an instance that leaves it empty it comes back relative
   * (`/api/integrations/{alias}`) — the alias is still correct.
   */
  private normalize(raw: { id: number; url: string }): IntegrationAlias {
    const url = raw.url ?? "";
    const alias = url.split("/").filter((s) => s !== "").pop() ?? "";
    return { ...raw, url, alias };
  }

  async list(projectId: number, integrationId?: number): Promise<IntegrationAlias[]> {
    const raw = await this.request<{ id: number; url: string }[]>(
      this.endpoint(projectId, integrationId),
    );
    return raw.map((a) => this.normalize(a));
  }

  /**
   * Creates an alias. There is nothing to pass: the server generates a random
   * 16-character string and ignores any body.
   */
  async create(projectId: number, integrationId?: number): Promise<IntegrationAlias> {
    const raw = await this.request<{ id: number; url: string }>(
      this.endpoint(projectId, integrationId),
      { method: "POST", body: {} },
    );
    return this.normalize(raw);
  }

  /**
   * Deletes an alias by id. Passing `integrationId` only picks the nested
   * route; the server deletes by project and alias id either way.
   */
  async delete(projectId: number, aliasId: number, integrationId?: number): Promise<void> {
    await this.request(`${this.endpoint(projectId, integrationId)}/${aliasId}`, {
      method: "DELETE",
    });
  }
}
