import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isInvalidSessionError, isTransientAuthError, resolveRestoredSession } from "../src/services/session-restore.js";
import { resolveLinkedInCompanyUrl } from "../src/social-links.js";
import { resolveAuthRedirectUrl, NATIVE_AUTH_REDIRECT_URL } from "../src/services/auth-redirect.js";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [app, auth, migration, gradle, workflow] = await Promise.all([
  read("../index.html"),
  read("../src/services/auth.js"),
  read("../supabase/migrations/20261103000100_listing_lock_integrity.sql"),
  read("../android/app/build.gradle"),
  read("../.github/workflows/android-apk.yml"),
]);

const session = { user: { id: "u1", email: "a@b.co" } };

test("offline or server errors never clear a stored session", async () => {
  for (const error of [
    Object.assign(new Error("fetch"), { name: "AuthRetryableFetchError", status: 0 }),
    Object.assign(new Error("boom"), { status: 503 }),
    new TypeError("Failed to fetch"),
  ]) {
    assert.equal(isTransientAuthError(error), true);
    const result = await resolveRestoredSession(session, async () => { throw error; });
    assert.equal(result.action, "offline");
    assert.equal(result.user, session.user);
  }
});

test("only definitive auth rejections trigger a local sign-out", async () => {
  for (const error of [{ status: 401 }, { code: "session_not_found" }, { code: "refresh_token_not_found" }]) {
    assert.equal(isInvalidSessionError(error), true);
    assert.equal((await resolveRestoredSession(session, async () => { throw error; })).action, "signout-local");
  }
  assert.equal((await resolveRestoredSession(session, async () => session.user)).action, "use");
  assert.equal((await resolveRestoredSession(null, async () => null)).action, "none");
});

test("sign-out is scoped to this device and lifecycle resumes auto-refresh", () => {
  assert.doesNotMatch(auth, /auth\.signOut\(\)/);
  assert.doesNotMatch(app, /auth\.signOut\(\)/);
  assert.match(auth, /startAutoRefresh/);
  assert.match(auth, /stopAutoRefresh/);
  assert.match(auth, /appStateChange/);
});

test("LinkedIn link is only produced for a valid https company page", () => {
  assert.equal(resolveLinkedInCompanyUrl(""), "");
  assert.equal(resolveLinkedInCompanyUrl("javascript:alert(1)"), "");
  assert.equal(resolveLinkedInCompanyUrl("http://www.linkedin.com/company/x"), "");
  assert.equal(resolveLinkedInCompanyUrl("https://evil.example/company/x"), "");
  assert.equal(resolveLinkedInCompanyUrl("https://www.linkedin.com/in/someone"), "");
  assert.equal(resolveLinkedInCompanyUrl("https://www.linkedin.com/company/walletswap/?x=1"), "https://www.linkedin.com/company/walletswap/");
  assert.match(app, /rel="noopener noreferrer"[^>]*aria-label="WalletSwap on LinkedIn/);
});

test("native signup uses a hosted HTTPS callback when configured, custom scheme otherwise", () => {
  assert.equal(resolveAuthRedirectUrl({ isNative: true }), NATIVE_AUTH_REDIRECT_URL);
  assert.equal(
    resolveAuthRedirectUrl({ isNative: true, configuredUrl: "https://app.example.test/x" }),
    "https://app.example.test/auth/callback",
  );
  assert.equal(resolveAuthRedirectUrl({ isNative: true, configuredUrl: "http://app.example.test" }), NATIVE_AUTH_REDIRECT_URL);
});

test("listing lock migration enforces lock server-side and is a reviewed, unapplied file", () => {
  assert.match(migration, /REVIEW REQUIRED/);
  assert.match(migration, /create trigger wallet_cards_enforce_listing_lock/);
  assert.match(migration, /card_has_open_listing/);
  assert.match(migration, /already have an open proposal/);
  assert.match(migration, /marketplace_fee_percentage\(\)/);
  assert.match(migration, /balance_verification/);
  assert.doesNotMatch(migration, /disable row level security|drop table|truncate/i);
});

test("card details explain the internal lock and sell sheet uses configured fee", () => {
  assert.match(app, /Locked for sale<\/b> in WalletSwap|Locked for sale in WalletSwap/);
  assert.match(app, /does not stop anyone from using the card at the original retailer/);
  assert.match(app, /data-s="sell"/);
  assert.match(app, /walletswap fee \(\$\{feeLabel\}%\)/);
});

test("card details keep the main tab bar and no overlay blocks navigation", () => {
  assert.match(app, /case "card": body = vCard\(a, r\.parts\[2\]\); tab = "wallet"; break;/);
  assert.match(app, /\$\{tabbar\(tab\)\}/);
  assert.doesNotMatch(app, /\.tabbar\{[^}]*pointer-events:\s*none/);
});

test("android version increments and APK build exposes optional stable signing key", () => {
  assert.match(gradle, /applicationId "com\.walletswap\.app"/);
  assert.match(gradle, /versionCode 2/);
  assert.match(workflow, /ANDROID_DEBUG_KEYSTORE_BASE64/);
});
test("migration restates least-privilege grants and the unique open-listing index", () => {
  assert.match(migration, /revoke all on function public\.create_marketplace_listing\(uuid, numeric\) from public, anon/);
  assert.match(migration, /revoke all on function public\.enforce_listing_lock\(\) from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.marketplace_fee_percentage\(\) from public, anon/);
  assert.match(migration, /create unique index if not exists marketplace_one_open_listing_per_card_idx/);
  assert.doesNotMatch(migration, /grant execute[^;]*to (public|anon)/i);
});
