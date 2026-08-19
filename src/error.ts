export class SemaphoreApiError extends Error {
  override readonly name = "SemaphoreApiError";

  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly code?: string,
    readonly body?: unknown,
    /** HTTP method of the failed request, when the client knows it. */
    readonly method?: string,
    /** API endpoint (without the `/api` prefix), when the client knows it. */
    readonly endpoint?: string,
  ) {
    const bodyStr = typeof body === "string" ? body : undefined;
    super(`Semaphore API ${status}: ${statusText}${bodyStr ? ` - ${bodyStr}` : ""}`);
  }

  get isAuth(): boolean { return this.status === 401; }
  get isPermission(): boolean { return this.status === 403; }
  get isNotFound(): boolean { return this.status === 404; }
  get isRateLimit(): boolean { return this.status === 429; }
  get isTimeout(): boolean { return this.status === 408; }
}
