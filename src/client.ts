import { SemaphoreApiError } from "./error.js";
import { ProjectsResource } from "./resources/projects.js";
import { KeysResource } from "./resources/keys.js";
import { RepositoriesResource } from "./resources/repositories.js";
import { InventoryResource } from "./resources/inventory.js";
import { EnvironmentResource } from "./resources/environment.js";
import { TemplatesResource } from "./resources/templates.js";
import { TasksResource } from "./resources/tasks.js";
import { SchedulesResource } from "./resources/schedules.js";
import { UsersResource } from "./resources/users.js";
import { ViewsResource } from "./resources/views.js";
import type { SemaphoreClientConfig, RequestOptions, SemaphoreInfo } from "./types.js";

export type RequestFn = <T = unknown>(endpoint: string, options?: RequestOptions) => Promise<T>;

export class SemaphoreClient {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly defaultTimeout: number;
  private readonly maxRetries: number;
  private readonly retryOn: number[];
  private readonly onRequest?: SemaphoreClientConfig["onRequest"];
  private readonly onResponse?: SemaphoreClientConfig["onResponse"];

  readonly projects: ProjectsResource;
  readonly keys: KeysResource;
  readonly repositories: RepositoriesResource;
  readonly inventory: InventoryResource;
  readonly environment: EnvironmentResource;
  readonly templates: TemplatesResource;
  readonly tasks: TasksResource;
  readonly schedules: SchedulesResource;
  readonly users: UsersResource;
  readonly views: ViewsResource;

  constructor(config: SemaphoreClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiToken = config.apiToken;
    this.defaultTimeout = config.timeout ?? 30_000;
    this.maxRetries = config.retry?.maxRetries ?? 2;
    this.retryOn = config.retry?.retryOn ?? [429, 502, 503, 504];
    this.onRequest = config.onRequest;
    this.onResponse = config.onResponse;

    const request: RequestFn = this.request.bind(this);
    this.projects = new ProjectsResource(request);
    this.keys = new KeysResource(request);
    this.repositories = new RepositoriesResource(request);
    this.inventory = new InventoryResource(request);
    this.environment = new EnvironmentResource(request);
    this.templates = new TemplatesResource(request);
    this.tasks = new TasksResource(request);
    this.schedules = new SchedulesResource(request);
    this.users = new UsersResource(request);
    this.views = new ViewsResource(request);
  }

  async info(): Promise<SemaphoreInfo> {
    return this.request<SemaphoreInfo>("/info");
  }

  async ping(): Promise<boolean> {
    try {
      await fetch(`${this.baseUrl}/api/ping`, {
        signal: AbortSignal.timeout(this.defaultTimeout),
      });
      return true;
    } catch {
      return false;
    }
  }

  private async request<T = unknown>(endpoint: string, options?: RequestOptions): Promise<T> {
    const method = options?.method ?? "GET";
    const url = new URL(`${this.baseUrl}/api${endpoint}`);

    if (options?.params) {
      for (const [k, v] of Object.entries(options.params)) url.searchParams.set(k, v);
    }

    const headers: Record<string, string> = {
      "Authorization": `Bearer ${this.apiToken}`,
      "Content-Type": "application/json",
    };

    const urlStr = url.toString();
    this.onRequest?.({ method, url: urlStr });

    let lastError = new SemaphoreApiError(0, "No attempts made");
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 10_000)));
      }

      const start = Date.now();
      const res = await fetch(urlStr, {
        method,
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
        signal: options?.signal ?? AbortSignal.timeout(options?.timeout ?? this.defaultTimeout),
      });

      this.onResponse?.({ method, url: urlStr, status: res.status, durationMs: Date.now() - start });

      if (res.ok || res.status === 204) {
        if (res.status === 204) return undefined as T;
        return res.json() as Promise<T>;
      }

      const body = await res.text().catch(() => "");
      lastError = new SemaphoreApiError(res.status, res.statusText, undefined, body || undefined);

      if (!this.retryOn.includes(res.status)) break;
    }

    throw lastError;
  }
}
