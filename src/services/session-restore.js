const INVALID_SESSION_CODES = new Set([
  "session_not_found",
  "session_expired",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "user_not_found",
  "bad_jwt",
  "invalid_jwt",
  "no_authorization",
]);

export const LOCAL_SIGN_OUT = Object.freeze({ scope: "local" });

// An invalid session is a definitive answer from Supabase Auth that the stored
// credentials can no longer be used. Everything else (offline, timeouts, 5xx)
// is transient and must never delete the stored session.
export function isInvalidSessionError(error) {
  if (!error) return false;
  const code = String(error.code || error.error_code || "");
  if (INVALID_SESSION_CODES.has(code)) return true;
  const status = Number(error.status);
  return status === 401 || status === 403;
}

export function isTransientAuthError(error) {
  if (!error || isInvalidSessionError(error)) return false;
  if (error.name === "AuthRetryableFetchError") return true;
  const status = Number(error.status);
  if (!Number.isFinite(status) || status === 0 || status === 408 || status === 429 || status >= 500) return true;
  return error instanceof TypeError;
}

// Decide what the app does with a stored session at startup.
// Returns { action: "use" | "signout-local" | "offline", user }.
export async function resolveRestoredSession(session, fetchUser) {
  if (!session?.user) return { action: "none", user: null };
  try {
    const user = await fetchUser();
    return { action: "use", user: user || session.user };
  } catch (error) {
    if (isInvalidSessionError(error)) return { action: "signout-local", user: null };
    return { action: "offline", user: session.user };
  }
}
