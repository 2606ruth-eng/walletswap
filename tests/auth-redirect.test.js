import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  authCallbackRouteFromUrl,
  authCallbackStatusFromUrl,
  classifyAuthCallbackError,
  completeAuthCallback,
} from "../src/services/auth-callback.js";
import {
  AUTH_CALLBACK_PATH,
  AUTH_RECOVERY_CALLBACK_PATH,
  NATIVE_AUTH_REDIRECT_URL,
  NATIVE_AUTH_RECOVERY_REDIRECT_URL,
  resolveAuthRedirectUrl,
} from "../src/services/auth-redirect.js";

const [androidManifest, iosInfo, iosScene, authSource, supabaseSource, appSource, supabaseConfig, envExample] = await Promise.all([
  readFile(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8"),
  readFile(new URL("../ios/App/App/Info.plist", import.meta.url), "utf8"),
  readFile(new URL("../ios/App/App/SceneDelegate.swift", import.meta.url), "utf8"),
  readFile(new URL("../src/services/auth.js", import.meta.url), "utf8"),
  readFile(new URL("../src/services/supabase.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
  readFile(new URL("../.env.example", import.meta.url), "utf8"),
]);

test("local web callbacks use the actual Vite origin rather than a localhost override", () => {
  assert.equal(resolveAuthRedirectUrl({
    isDevelopment: true,
    origin: "http://192.168.1.24:5173",
    configuredUrl: "http://localhost:5173/",
  }), "http://192.168.1.24:5173/auth/callback");
});

test("hosted web callbacks use the configured HTTPS origin and preserve separate recovery routing", () => {
  assert.equal(resolveAuthRedirectUrl({
    origin: "https://preview.walletswap.example",
    configuredUrl: "https://walletswap.example",
  }), `https://walletswap.example${AUTH_CALLBACK_PATH}`);
  assert.equal(resolveAuthRedirectUrl({
    origin: "https://walletswap.example",
    purpose: "recovery",
  }), `https://walletswap.example${AUTH_RECOVERY_CALLBACK_PATH}`);
});

test("hosted callbacks reject stale localhost targets and insecure remote origins", () => {
  assert.throws(() => resolveAuthRedirectUrl({
    origin: "https://walletswap.example",
    configuredUrl: "http://localhost:5173/",
  }), /must use HTTPS/);
  assert.throws(() => resolveAuthRedirectUrl({
    origin: "http://walletswap.example",
    configuredUrl: "",
  }), /must use HTTPS/);
});

test("native Android and iOS callbacks use registered WalletSwap schemes", () => {
  assert.equal(resolveAuthRedirectUrl({ isNative: true }), NATIVE_AUTH_REDIRECT_URL);
  assert.equal(resolveAuthRedirectUrl({ isNative: true, purpose: "recovery" }), NATIVE_AUTH_RECOVERY_REDIRECT_URL);
  assert.match(androidManifest, /android:scheme="walletswap" android:host="auth" android:pathPrefix="\/"/);
  assert.match(iosInfo, /<string>walletswap<\/string>/);
  assert.match(iosScene, /SceneDelegateProxy\.shared\.scene\(scene, openURLContexts: URLContexts\)/);
  assert.match(authSource, /App\.getLaunchUrl\(\)/);
  assert.match(authSource, /App\.addListener\("appUrlOpen"/);
});

test("confirmation codes exchange for a session without exposing callback contents", async () => {
  let receivedCode = "";
  const result = await completeAuthCallback("http://localhost:5173/auth/callback?code=one-time-code", {
    async exchangeCodeForSession(code) {
      receivedCode = code;
      return { data: { session: { user: { id: "user-id" } } }, error: null };
    },
  });
  assert.deepEqual(result, { status: "confirmed" });
  assert.equal(receivedCode, "one-time-code");
});

test("expired links show an expired state without trying to exchange a code", async () => {
  let exchanged = false;
  const url = "walletswap://auth/callback?error=access_denied&error_code=otp_expired";
  assert.deepEqual(authCallbackStatusFromUrl(url), { status: "expired" });
  assert.deepEqual(await completeAuthCallback(url, {
    async exchangeCodeForSession() { exchanged = true; return { error: null }; },
  }), { status: "expired" });
  assert.equal(exchanged, false);
  assert.deepEqual(classifyAuthCallbackError({ code: "flow_state_expired" }), { status: "expired" });
});

test("legacy token callbacks recover sessions and classify exchange failures safely", async () => {
  let sessionInput;
  assert.deepEqual(await completeAuthCallback(
    "walletswap://auth/callback#access_token=opaque&refresh_token=opaque-refresh",
    { async setSession(input) { sessionInput = input; return { data: { session: {} }, error: null }; } },
  ), { status: "confirmed" });
  assert.deepEqual(sessionInput, { access_token: "opaque", refresh_token: "opaque-refresh" });

  assert.deepEqual(await completeAuthCallback(
    "walletswap://auth/callback?code=expired-code",
    { async exchangeCodeForSession() { return { error: { code: "otp_expired" } }; } },
  ), { status: "expired" });
});

test("native recovery callbacks route separately from email confirmation callbacks", () => {
  assert.equal(authCallbackRouteFromUrl(NATIVE_AUTH_REDIRECT_URL), "/auth/callback");
  assert.equal(authCallbackRouteFromUrl(NATIVE_AUTH_RECOVERY_REDIRECT_URL), "/auth/recovery");
});

test("local Supabase configuration allows exact browser and native callback URLs", () => {
  for (const url of [
    "http://localhost:5173/auth/callback",
    "http://localhost:5173/auth/recovery",
    NATIVE_AUTH_REDIRECT_URL,
    NATIVE_AUTH_RECOVERY_REDIRECT_URL,
  ]) assert.ok(supabaseConfig.includes(`"${url}"`), `${url} should be allowlisted locally`);
  assert.match(envExample, /^VITE_SUPABASE_AUTH_REDIRECT_URL=$/m);
  assert.doesNotMatch(envExample, /VITE_SUPABASE_AUTH_REDIRECT_URL=http:\/\/localhost/);
});

test("browser callback routing recovers the session and preserves password recovery handling", () => {
  assert.match(supabaseSource, /detectSessionInUrl:\s*!isNative/);
  assert.match(appSource, /const session = await getAuthSession\(\)/);
  assert.match(authSource, /export async function getAuthenticatedUser\(\)/);
  assert.match(authSource, /requireSupabase\(\)\.auth\.getUser\(\)/);
  assert.match(appSource, /const authenticatedUser = await getAuthenticatedUser\(\)/);
  assert.match(appSource, /event === "PASSWORD_RECOVERY"/);
  assert.match(authSource, /emailRedirectTo:\s*authRedirectUrl\(\)/);
  assert.match(authSource, /redirectTo:\s*authRedirectUrl\("recovery"\)/);
  assert.match(appSource, /go\("\/update-password"\)/);
  assert.match(appSource, /Email successfully confirmed/);
  assert.match(appSource, /Password reset link expired/);
  assert.match(appSource, /Confirmation link expired/);
  assert.match(appSource, /Confirmation error/);
  assert.match(appSource, /href="#\/login">Return to login/);
  assert.match(appSource, /This local address only works on this computer/);
  assert.match(appSource, /rootHashCallback/);
});
