export class SemaphoreApiError extends Error {
  override readonly name = "SemaphoreApiError";

  constructor(
    readonly status: number,
    readonly statusText: string,
    /**
     * Set by the client, not by the server, for failures that are not an HTTP
     * status: `"TIMEOUT"`, `"REJECTED"`, `"WAITING_CONFIRMATION"` and `"ABORTED"`
     * from `tasks.waitForCompletion()`. Those errors carry `status: 0`.
     */
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
  /** HTTP 408 only. `waitForCompletion()` running out of time is `code === "TIMEOUT"`, not this. */
  get isTimeout(): boolean { return this.status === 408; }
}
