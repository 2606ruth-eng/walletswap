import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyOtpError, normalizeOtpCode, resendSecondsRemaining, validateOtpCode } from "../src/services/auth-otp.js";
import { hasSeenOnboarding, markOnboardingSeen, onboardingKey } from "../src/onboarding.js";
import { HELP_STEPS } from "../src/help-tour.js";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [app, auth, config, template] = await Promise.all([
  read("../index.html"), read("../src/services/auth.js"), read("../supabase/config.toml"), read("../supabase/templates/confirmation.html"),
]);

test("OTP codes are normalized and validated client-side for format only", () => {
  assert.equal(normalizeOtpCode(" 123 456 "), "123456");
  assert.equal(normalizeOtpCode("123-456"), "123456");
  assert.equal(validateOtpCode("123456"), "");
  assert.equal(validateOtpCode("12345"), "Enter the numeric code from your email.");
  assert.notEqual(validateOtpCode("12ab56"), "");
  assert.equal(validateOtpCode("12345678"), "");
});

test("OTP errors map to safe messages without revealing account state", () => {
  assert.equal(classifyOtpError({ code: "otp_expired" }).kind, "invalid");
  assert.equal(classifyOtpError({ status: 429 }).kind, "rate-limited");
  assert.equal(classifyOtpError({ name: "AuthRetryableFetchError" }).kind, "unavailable");
  assert.equal(classifyOtpError({}).kind, "unknown");
  assert.match(classifyOtpError({ code: "otp_expired" }).message, /incorrect or has expired/);
});

test("resend cooldown counts down and never goes negative", () => {
  assert.equal(resendSecondsRemaining(0, 1000), 0);
  assert.equal(resendSecondsRemaining(1000, 1000), 60);
  assert.equal(resendSecondsRemaining(1000, 31000), 30);
  assert.equal(resendSecondsRemaining(1000, 999999), 0);
});

test("verifySignupCode uses Supabase verifyOtp with the signup type", () => {
  assert.match(auth, /auth\.verifyOtp\(\{[\s\S]*?type:\s*"signup"/);
  assert.match(app, /verifySignupCode\(\{ email, token: code \}\)/);
  assert.match(app, /autocomplete="one-time-code"/);
  assert.match(app, /inputmode="numeric"/);
});

test("Confirm signup template must render the OTP token and is wired in config", () => {
  assert.match(template, /\{\{\s*\.Token\s*\}\}/);
  assert.doesNotMatch(template, /ConfirmationURL/);
  assert.match(config, /\[auth\.email\.template\.confirmation\][\s\S]*?content_path\s*=\s*"\.\/supabase\/templates\/confirmation\.html"/);
  assert.match(config, /enable_confirmations\s*=\s*true/);
  assert.match(config, /otp_length\s*=\s*6/);
});

test("onboarding is one-time per account and fails closed", () => {
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(hasSeenOnboarding(storage, "A@x.com"), false);
  markOnboardingSeen(storage, "A@x.com");
  assert.equal(hasSeenOnboarding(storage, "a@x.com"), true);
  assert.equal(hasSeenOnboarding(storage, "b@x.com"), false);
  assert.equal(onboardingKey("A@x.com"), "walletswap.onboarding.v1.a@x.com");
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(hasSeenOnboarding(broken, "a@x.com"), true);
  assert.doesNotThrow(() => markOnboardingSeen(broken, "a@x.com"));
  assert.equal(hasSeenOnboarding(storage, ""), true);
});

test("guide is interactive, skippable, accessible and replayable", () => {
  assert.ok(HELP_STEPS.filter(s => s.route && s.cta).length >= 3);
  assert.match(app, /maybeStartOnboarding\(r, a\)/);
  assert.match(app, /data-act="tutorial-show"/);
  assert.match(app, /data-act="tutorial-replay"/);
  assert.match(app, /aria-label="Skip guide"/);
  assert.match(app, /role="region" aria-label="WalletSwap first-use guide" aria-live="polite"/);
  assert.match(app, /prefers-reduced-motion:no-preference\)\{\.tour-coach/);
  assert.match(app, /ui\.tutorial\.mode !== "onboarding"/);
});
