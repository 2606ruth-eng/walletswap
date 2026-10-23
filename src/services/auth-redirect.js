export const AUTH_CALLBACK_PATH = "/auth/callback";
export const AUTH_RECOVERY_CALLBACK_PATH = "/auth/recovery";
export const NATIVE_AUTH_REDIRECT_URL = "walletswap://auth/callback";
export const NATIVE_AUTH_RECOVERY_REDIRECT_URL = "walletswap://auth/recovery";

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function resolveAuthRedirectUrl({
  isNative = false,
  isDevelopment = false,
  configuredUrl = "",
  origin,
  purpose = "confirmation",
} = {}) {
  if (isNative) {
    return purpose === "recovery" ? NATIVE_AUTH_RECOVERY_REDIRECT_URL : NATIVE_AUTH_REDIRECT_URL;
  }

  let currentOrigin;
  try {
    currentOrigin = new URL(origin);
  } catch {
    throw new Error("WalletSwap needs a valid browser origin for authentication callbacks.");
  }

  const configured = String(configuredUrl || "").trim();
  let target;
  try {
    target = isDevelopment || !configured ? new URL(currentOrigin.origin) : new URL(configured);
  } catch {
    throw new Error("VITE_SUPABASE_AUTH_REDIRECT_URL must be a valid absolute URL.");
  }

  if (target.username || target.password) {
    throw new Error("Authentication callback URLs cannot contain credentials.");
  }

  const isCurrentDevOrigin = isDevelopment && target.origin === currentOrigin.origin;
  const isCurrentLoopback = target.origin === currentOrigin.origin && isLoopback(target.hostname);
  if (target.protocol !== "https:" && !isCurrentDevOrigin && !isCurrentLoopback) {
    throw new Error("Hosted authentication callbacks must use HTTPS.");
  }

  target.pathname = purpose === "recovery" ? AUTH_RECOVERY_CALLBACK_PATH : AUTH_CALLBACK_PATH;
  target.search = "";
  target.hash = "";
  return target.toString();
}
