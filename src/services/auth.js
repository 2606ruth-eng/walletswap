import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { authCallbackRouteFromUrl, authCallbackStatusFromUrl, completeAuthCallback } from "./auth-callback.js";
import { resolveAuthRedirectUrl } from "./auth-redirect.js";
import { LOCAL_SIGN_OUT } from "./session-restore.js";
import { requireSupabase } from "./supabase.js";

export function authRedirectUrl(purpose = "confirmation") {
  const env = import.meta.env || {};
  return resolveAuthRedirectUrl({
    isNative: Capacitor.isNativePlatform(),
    isDevelopment: Boolean(env.DEV),
    configuredUrl: env.VITE_SUPABASE_AUTH_REDIRECT_URL,
    origin: window.location.origin,
    purpose,
  });
}

export async function signUp({ displayName, email, password }) {
  const client = requireSupabase();
  return client.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      data: { display_name: displayName.trim().slice(0, 80) },
      emailRedirectTo: authRedirectUrl(),
    },
  });
}

export async function signIn({ email, password }) {
  return requireSupabase().auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
}

export async function resendSignupConfirmation(email) {
  return requireSupabase().auth.resend({
    type: "signup",
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: authRedirectUrl() },
  });
}

export async function verifySignupCode({ email, token }) {
  return requireSupabase().auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: String(token).replace(/[\s-]/g, ""),
    type: "signup",
  });
}

export async function signOut() {
  return requireSupabase().auth.signOut(LOCAL_SIGN_OUT);
}

export async function sendPasswordReset(email) {
  return requireSupabase().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: authRedirectUrl("recovery"),
  });
}

export async function updatePassword(password) {
  return requireSupabase().auth.updateUser({ password });
}

export async function updateProfileName(displayName) {
  const client = requireSupabase();
  const name = String(displayName || "").trim().slice(0, 80);
  if (name.length < 2) throw new Error("Enter a name with at least two characters.");
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!authData.user) throw new Error("Sign in before updating your profile.");
  const { error } = await client.from("profiles").update({ display_name: name }).eq("id", authData.user.id);
  if (error) throw error;
  return name;
}

export async function getAuthSession() {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getAuthenticatedUser() {
  const { data, error } = await requireSupabase().auth.getUser();
  if (error) throw error;
  return data.user;
}

export async function deleteCurrentAccount() {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke("account-delete", { body: {} });
  if (error) throw error;
  const { error: signOutError } = await client.auth.signOut(LOCAL_SIGN_OUT);
  if (signOutError) throw signOutError;
  return data;
}

export async function registerAuthDeepLinks({ onResult = () => {}, onError = () => {} } = {}) {
  if (!Capacitor.isNativePlatform()) return () => {};
  const handleUrl = async url => {
    const initial = authCallbackStatusFromUrl(url);
    const route = authCallbackRouteFromUrl(url);
    if (initial) onResult(initial, route);
    try {
      const result = await completeAuthCallback(url, requireSupabase().auth);
      if (result.status !== "ignored") onResult(result, route);
    } catch {
      onError({ status: "error" }, route);
    }
  };
  const launch = await App.getLaunchUrl();
  if (launch?.url) await handleUrl(launch.url);
  const listener = await App.addListener("appUrlOpen", event => {
    void handleUrl(event.url);
  });
  return () => listener.remove();
}

// Supabase recommends pausing token auto-refresh while a native app is backgrounded
// and refreshing immediately on resume. Resume also lets the caller retry a restore
// that failed because the device was offline.
export async function registerAuthLifecycle({ onResume = () => {} } = {}) {
  const client = requireSupabase();
  const cleanups = [];
  const online = () => onResume("online");
  window.addEventListener("online", online);
  cleanups.push(() => window.removeEventListener("online", online));
  if (Capacitor.isNativePlatform()) {
    const listener = await App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
        client.auth.startAutoRefresh();
        onResume("foreground");
      } else {
        client.auth.stopAutoRefresh();
      }
    });
    cleanups.push(() => listener.remove());
  }
  return () => cleanups.forEach(fn => fn());
}
