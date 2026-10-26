import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateSupabaseBuildEnvironment, verifySupabaseBuildAssets } from "../scripts/verify-cloud-build.mjs";

const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const [app, supabaseClient, auth, authRedirect, rubyClient] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/services/supabase.js", import.meta.url), "utf8"),
  readFile(new URL("../src/services/auth.js", import.meta.url), "utf8"),
  readFile(new URL("../src/services/auth-redirect.js", import.meta.url), "utf8"),
  readFile(new URL("../src/services/ruby.js", import.meta.url), "utf8"),
]);

test("build-time Supabase configuration requires the exact frontend variable names", () => {
  const config = validateSupabaseBuildEnvironment({
    VITE_SUPABASE_URL: "https://walletswap.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
  });
  assert.equal(config.url, "https://walletswap.supabase.co");
  assert.equal(config.publishableKey, "sb_publishable_example");
  assert.throws(() => validateSupabaseBuildEnvironment({}), /VITE_SUPABASE_URL is missing/);
  assert.throws(() => validateSupabaseBuildEnvironment({
    VITE_SUPABASE_URL: "https://walletswap.supabase.co",
  }), /VITE_SUPABASE_PUBLISHABLE_KEY is missing/);
  assert.throws(() => validateSupabaseBuildEnvironment({
    VITE_SUPABASE_URL: "http://walletswap.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "public-key",
  }), /must be a valid HTTPS URL/);
  assert.throws(() => validateSupabaseBuildEnvironment({
    VITE_SUPABASE_URL: "https://walletswap.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_do_not_use",
  }), /must be a public publishable key/);
  const legacyServiceRole = `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
  assert.throws(() => validateSupabaseBuildEnvironment({
    VITE_SUPABASE_URL: "https://walletswap.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: legacyServiceRole,
  }), /must be a public publishable key/);
});

test("build verifier confirms configuration is present in built assets without logging values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "walletswap-build-test-"));
  try {
    const assets = join(directory, "assets");
    await mkdir(assets);
    const config = { url: "https://walletswap.supabase.co", publishableKey: "sb_publishable_test" };
    await writeFile(join(assets, "app.js"), `createClient("${config.url}", "${config.publishableKey}"); Ruby Live needs a cloud account`);
    await verifySupabaseBuildAssets(config, directory);
    await writeFile(join(assets, "app.js"), "createClient('', '')");
    await assert.rejects(verifySupabaseBuildAssets(config, directory), /compiled app is missing/);
    await writeFile(join(assets, "app.js"), `createClient("${config.url}", "${config.publishableKey}")`);
    await assert.rejects(verifySupabaseBuildAssets(config, directory), /missing the Ruby experience/);
    await writeFile(join(assets, "app.js"), `createClient("${config.url}", "${config.publishableKey}"); Ruby Live needs a cloud account; OPENAI_API_KEY="should-never-be-here"`);
    await assert.rejects(verifySupabaseBuildAssets(config, directory), /server credential pattern/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Android CI validates and builds Supabase configuration before Capacitor sync", () => {
  const androidJob = workflow.slice(workflow.indexOf("android-debug:"));
  assert.match(workflow, /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\|\|\s*github\.sha\s*\}\}/);
  assert.match(androidJob, /VITE_SUPABASE_URL:\s*\$\{\{\s*vars\.VITE_SUPABASE_URL\s*\}\}/);
  assert.match(androidJob, /vars\.VITE_SUPABASE_PUBLISHABLE_KEY\s*\|\|\s*vars\.VITE_SUPABASE_PUBLISHED_KEY/);
  assert.ok(androidJob.indexOf("npm ci") < androidJob.indexOf("npm run verify:cloud-config"));
  assert.ok(androidJob.indexOf("npm run verify:cloud-config") < androidJob.indexOf("npm test"));
  assert.ok(androidJob.indexOf("npm test") < androidJob.indexOf("npm run build"));
  assert.ok(androidJob.indexOf("npm run build") < androidJob.indexOf("npm run verify:cloud-build"));
  assert.ok(androidJob.indexOf("npm run verify:cloud-build") < androidJob.indexOf("npx cap sync android"));
  assert.ok(androidJob.indexOf("npx cap sync android") < androidJob.indexOf("assembleDebug"));
  assert.match(workflow, /name:\s*walletswap-android-configured-debug/);
});

test("Android auth and Ruby use the configured authenticated Supabase client", () => {
  assert.match(supabaseClient, /VITE_SUPABASE_URL/);
  assert.match(supabaseClient, /VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(supabaseClient, /createClient\(url,\s*publishableKey/);
  assert.match(supabaseClient, /persistSession:\s*true/);
  assert.match(supabaseClient, /autoRefreshToken:\s*true/);
  assert.match(auth, /signInWithPassword/);
  assert.match(auth, /emailRedirectTo:\s*authRedirectUrl\(\)/);
  assert.match(auth, /auth\.resend/);
  assert.match(authRedirect, /walletswap:\/\/auth\/callback/);
  assert.match(auth, /App\.addListener\("appUrlOpen"/);
  assert.match(rubyClient, /functions\.invoke\("ruby-chat"/);
  assert.match(app, /r\.parts\[1\] === "ruby" && a && !a\.demo && supabaseConfigured/);
  assert.match(app, /You're using the local demo wallet/);
  assert.match(app, /demo account is not sent to Ruby/);
  assert.match(app, /Ruby AI is available in WalletSwap after sign-in/);
  assert.match(app, /s !== "ruby" \? `<a class="ruby-fab"/);
});
