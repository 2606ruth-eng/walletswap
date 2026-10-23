import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [authSource, appSource] = await Promise.all([
  readFile(new URL("../src/services/auth.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
]);

test("signup confirmation can be safely resent to the attempted address", () => {
  assert.match(authSource, /auth\.resend\(\{[\s\S]*?type:\s*"signup"[\s\S]*?email:\s*email\.trim\(\)\.toLowerCase\(\)[\s\S]*?emailRedirectTo:\s*authRedirectUrl\(\)/);
  assert.match(appSource, /data-act="resend-confirmation"/);
  assert.match(appSource, /If this account needs confirmation, the request was accepted/);
});

test("signup with required email confirmation keeps the email and explains the next step", () => {
  assert.match(appSource, /!data\.session \|\| !data\.user/);
  assert.match(appSource, /Email confirmation is required before sign-in/);
  assert.match(appSource, /ui\.f = \{ email \}/);
});

test("login distinguishes unconfirmed accounts without exposing account existence", () => {
  assert.match(appSource, /error\.code === "email_not_confirmed"/);
  assert.match(appSource, /Your account needs email confirmation before you can log in/);
  assert.match(appSource, /That email and password could not be verified/);
});

test("confirmation delivery failures identify safe SMTP and rate-limit actions", () => {
  assert.match(appSource, /error\?\.code === "over_email_send_rate_limit" \|\| error\?\.status === 429/);
  assert.match(appSource, /error\?\.code === "email_address_not_authorized"/);
  assert.match(appSource, /Check the project's SMTP settings and organization membership/);
  assert.match(appSource, /Check the project's email delivery settings or try again later/);
});
