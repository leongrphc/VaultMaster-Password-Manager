import test from "node:test";
import assert from "node:assert/strict";
import {
  getRequestIp,
  getRequestUserAgent,
  inferDeviceType,
  resolveRequestId,
} from "../dist/utils/request-context.js";

test("getRequestIp prefers x-forwarded-for when present", () => {
  const request = {
    headers: {
      "x-forwarded-for": "203.0.113.10, 10.0.0.1",
    },
    ip: "::1",
  };

  assert.equal(getRequestIp(request), "203.0.113.10");
});

test("getRequestUserAgent truncates oversized user agents", () => {
  const userAgent = "a".repeat(300);
  const request = {
    headers: {
      "user-agent": userAgent,
    },
  };

  assert.equal(getRequestUserAgent(request).length, 255);
});

test("inferDeviceType distinguishes mobile and web clients", () => {
  assert.equal(
    inferDeviceType("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"),
    "mobile"
  );
  assert.equal(inferDeviceType("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "web");
  assert.equal(inferDeviceType(null), "unknown");
});

test("resolveRequestId never reuses incoming identifiers, including UUIDs", () => {
  for (const value of ["req-123", "synthetic@email.test", "9d151da8-2bfe-4b26-80df-94a90f56bbe0", ["secret"]]) {
    assert.notEqual(resolveRequestId(value), value);
    assert.match(resolveRequestId(value), /^[0-9a-f-]{36}$/);
  }
});

test("resolveRequestId generates ids when header is missing", () => {
  const requestId = resolveRequestId(undefined);
  assert.equal(typeof requestId, "string");
  assert.ok(requestId.length > 10);
});
