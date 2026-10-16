import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAuthError, retryAfterSeconds, isNetworkError } from "../../js/auth-errors.js";

test("classifies expired or invalid codes", () => {
  assert.equal(classifyAuthError({ name: "AuthApiError", status: 403, code: "otp_expired", message: "Token has expired or is invalid" }), "code-invalid");
  assert.equal(classifyAuthError({ name: "AuthApiError", status: 400, message: "Token has expired or is invalid" }), "code-invalid");
});

test("classifies rate limits", () => {
  assert.equal(classifyAuthError({ status: 429, code: "over_email_send_rate_limit", message: "For security purposes, you can only request this after 42 seconds." }), "rate-limit");
  assert.equal(classifyAuthError({ status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" }), "rate-limit");
});

test("classifies network failures", () => {
  assert.equal(classifyAuthError({ name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" }), "network");
  assert.equal(classifyAuthError(new TypeError("Failed to fetch")), "network");
  assert.equal(isNetworkError({ message: "TypeError: Failed to fetch", code: "" }), true);
  assert.equal(isNetworkError({ message: "Load failed" }), true);
});

test("classifies invalid email and everything else", () => {
  assert.equal(classifyAuthError({ status: 400, code: "email_address_invalid", message: "Email address is invalid" }), "email-invalid");
  assert.equal(classifyAuthError({ status: 422, code: "validation_failed", message: "Unable to validate email address: invalid format" }), "email-invalid");
  assert.equal(classifyAuthError({ status: 500, message: "boom" }), "unknown");
  assert.equal(classifyAuthError(null), "unknown");
});

test("retryAfterSeconds reads the wait from the message, defaulting to 60", () => {
  assert.equal(retryAfterSeconds({ message: "For security purposes, you can only request this after 42 seconds." }), 42);
  assert.equal(retryAfterSeconds({ message: "Email rate limit exceeded" }), 60);
  assert.equal(retryAfterSeconds(null), 60);
});
