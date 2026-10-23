import { Capacitor } from "@capacitor/core";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { createClient } from "@supabase/supabase-js";

const env = import.meta.env || {};
const url = String(env.VITE_SUPABASE_URL || "").trim();
const publishableKey = String(env.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim();

export function validateSupabaseConfig(config = { url, publishableKey }) {
  if (!config.url && !config.publishableKey) return { configured: false, error: "" };
  if (!config.url || !config.publishableKey) {
    return { configured: false, error: "Set both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY." };
  }
  try {
    const parsed = new URL(config.url);
    const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
      return { configured: false, error: "Supabase must use HTTPS except on localhost." };
    }
  } catch {
    return { configured: false, error: "VITE_SUPABASE_URL must be a valid HTTPS URL." };
  }
  if (/^(sb_secret_|service_role)/i.test(config.publishableKey)) {
    return { configured: false, error: "A server secret cannot be used as a frontend publishable key." };
  }
  return { configured: true, error: "" };
}

const configStatus = validateSupabaseConfig();
export const supabaseConfigured = configStatus.configured;
export const supabaseConfigError = configStatus.error;

const isNative = Capacitor.isNativePlatform();
const nativeStorageReady = isNative
  ? SecureStorage.setKeyPrefix("walletswap_supabase_auth_v1").then(() => SecureStorage.setSynchronize(false))
  : Promise.resolve();

const authStorage = {
  async getItem(key) {
    await nativeStorageReady;
    return isNative ? SecureStorage.getItem(key) : window.localStorage.getItem(key);
  },
  async setItem(key, value) {
    await nativeStorageReady;
    if (isNative) await SecureStorage.setItem(key, value);
    else window.localStorage.setItem(key, value);
  },
  async removeItem(key) {
    await nativeStorageReady;
    if (isNative) await SecureStorage.removeItem(key);
    else window.localStorage.removeItem(key);
  },
};

export const supabase = supabaseConfigured
  ? createClient(url, publishableKey, {
      auth: {
        storage: authStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: !isNative,
        flowType: "pkce",
      },
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error(supabaseConfigError || "WalletSwap cloud services have not been configured.");
  }
  return supabase;
}
