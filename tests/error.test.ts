import { test } from "node:test";
import assert from "node:assert/strict";
import { SemaphoreApiError } from "../src/error.js";

test("message includes status and statusText", () => {
  const e = new SemaphoreApiError(404, "Not Found");
  assert.match(e.message, /404/);
  assert.match(e.message, /Not Found/);
});

test("message includes body string when provided", () => {
  const e = new SemaphoreApiError(400, "Bad Request", undefined, '{"error":"invalid name"}');
  assert.match(e.message, /invalid name/);
});

test("message has no separator when body is absent", () => {
  const e = new SemaphoreApiError(500, "Server Error");
  assert.doesNotMatch(e.message, / - /);
});

test("name is SemaphoreApiError", () => {
  assert.equal(new SemaphoreApiError(500, "Error").name, "SemaphoreApiError");
});

test("is instanceof Error", () => {
  assert.ok(new SemaphoreApiError(500, "Error") instanceof Error);
});

test("exposes status and statusText", () => {
  const e = new SemaphoreApiError(422, "Unprocessable Entity");
  assert.equal(e.status, 422);
  assert.equal(e.statusText, "Unprocessable Entity");
});

test("isAuth true on 401 only", () => {
  assert.ok(new SemaphoreApiError(401, "").isAuth);
  assert.ok(!new SemaphoreApiError(403, "").isAuth);
  assert.ok(!new SemaphoreApiError(400, "").isAuth);
});

test("isPermission true on 403 only", () => {
  assert.ok(new SemaphoreApiError(403, "").isPermission);
  assert.ok(!new SemaphoreApiError(401, "").isPermission);
});

test("isNotFound true on 404 only", () => {
  assert.ok(new SemaphoreApiError(404, "").isNotFound);
  assert.ok(!new SemaphoreApiError(400, "").isNotFound);
  assert.ok(!new SemaphoreApiError(410, "").isNotFound);
});

test("isTimeout true on 408 only", () => {
  assert.ok(new SemaphoreApiError(408, "").isTimeout);
  assert.ok(!new SemaphoreApiError(504, "").isTimeout);
});

test("isRateLimit true on 429 only", () => {
  assert.ok(new SemaphoreApiError(429, "").isRateLimit);
  assert.ok(!new SemaphoreApiError(503, "").isRateLimit);
});

test("all getters false on 400", () => {
  const e = new SemaphoreApiError(400, "Bad Request");
  assert.ok(!e.isAuth && !e.isPermission && !e.isNotFound && !e.isTimeout && !e.isRateLimit);
});

test("body is accessible as property", () => {
  const e = new SemaphoreApiError(400, "Bad Request", undefined, "raw body");
  assert.equal(e.body, "raw body");
});
