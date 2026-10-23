import { AUTH_RECOVERY_CALLBACK_PATH } from "./auth-redirect.js";

const EXPIRED_CODES = new Set(["flow_state_expired", "otp_expired", "token_expired"]);

export function classifyAuthCallbackError(error) {
  const code = typeof error === "string"
    ? error
    : String(error?.error_code || error?.code || "");
  return { status: EXPIRED_CODES.has(code) ? "expired" : "error" };
}

export function authCallbackStatusFromUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { status: "error" };
  }

  const errorCode = parsed.searchParams.get("error_code") || parsed.searchParams.get("error");
  if (errorCode) return classifyAuthCallbackError(errorCode);

  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ""));
  if (parsed.searchParams.has("code") || (hash.has("access_token") && hash.has("refresh_token"))) {
    return { status: "processing" };
  }
  return null;
}

export function authCallbackRouteFromUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname === AUTH_RECOVERY_CALLBACK_PATH
      || (parsed.protocol === "walletswap:" && parsed.pathname === "/recovery")
      ? "/auth/recovery"
      : "/auth/callback";
  } catch {
    return "/auth/callback";
  }
}

export async function completeAuthCallback(rawUrl, auth) {
  const initial = authCallbackStatusFromUrl(rawUrl);
  if (!initial || initial.status === "expired" || initial.status === "error") {
    return initial || { status: "ignored" };
  }

  const parsed = new URL(rawUrl);
  const code = parsed.searchParams.get("code");
  try {
    if (code) {
      const { data, error } = await auth.exchangeCodeForSession(code);
      if (error) return classifyAuthCallbackError(error);
      return data?.session ? { status: "confirmed" } : { status: "error" };
    }

    const hash = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    if (accessToken && refreshToken) {
      const { data, error } = await auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) return classifyAuthCallbackError(error);
      return data?.session ? { status: "confirmed" } : { status: "error" };
    }
  } catch (error) {
    return classifyAuthCallbackError(error);
  }
  return { status: "ignored" };
}
