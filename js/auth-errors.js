// Maps Supabase auth / PostgREST errors to the few situations the UI explains.
// Codes come from @supabase/auth-js 2.117.2 (lib/error-codes.d.ts and lib/fetch.js).

const NETWORK_MESSAGE = /failed to fetch|load failed|networkerror|network request failed|fetch failed/i;

export function isNetworkError(error) {
  if (!error) return false;
  if (error.name === "AuthRetryableFetchError") return true;
  if (error instanceof TypeError && NETWORK_MESSAGE.test(error.message || "")) return true;
  return NETWORK_MESSAGE.test(String(error.message || ""));
}

// "code-invalid" | "rate-limit" | "network" | "email-invalid" | "unknown"
export function classifyAuthError(error) {
  if (!error) return "unknown";
  if (isNetworkError(error)) return "network";
  const code = String(error.code || "");
  const message = String(error.message || "");
  if (error.status === 429 || /rate_limit/.test(code)) return "rate-limit";
  if (code === "otp_expired" || /expired or is invalid|invalid otp|token has expired/i.test(message)) return "code-invalid";
  if (code === "email_address_invalid" || (code === "validation_failed" && /email/i.test(message))) return "email-invalid";
  return "unknown";
}

// Supabase answers "For security purposes, you can only request this after 42 seconds."
export function retryAfterSeconds(error, fallback = 60) {
  const match = /(\d+)\s*seconds?/i.exec(String(error && error.message || ""));
  const seconds = match ? Number(match[1]) : fallback;
  return seconds > 0 && seconds <= 3600 ? seconds : fallback;
}
