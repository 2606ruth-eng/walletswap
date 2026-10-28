import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  approvedOfficialBalanceUrl,
  getRetailerVerification,
} from "../src/services/retailer-verification.js";
import {
  ADYEN_TEST_ADAPTER_STATUS,
  CARD_BALANCE_PROVIDERS,
  buildAdyenCheckBalanceRequest,
  createAdyenTestAdapter,
  getCardBalanceProvider,
  parseAdyenCheckBalanceResponse,
  safeProviderErrorCategory,
  validateNormalizedProviderResult,
} from "../supabase/functions/_shared/card-balance-providers.js";

const root = new URL("../", import.meta.url);
const [migration, functionSource, ui, wallet, ruby, config, workflow, setup] = await Promise.all([
  readFile(new URL("supabase/migrations/20261028000600_gift_card_verification.sql", root), "utf8"),
  readFile(new URL("supabase/functions/check-card-balance/index.ts", root), "utf8"),
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("src/services/wallet.js", root), "utf8"),
  readFile(new URL("supabase/functions/ruby-chat/index.ts", root), "utf8"),
  readFile(new URL("supabase/config.toml", root), "utf8"),
  readFile(new URL(".github/workflows/android-apk.yml", root), "utf8"),
  readFile(new URL("VERIFICATION_SETUP.md", root), "utf8"),
]);

test("Target and Starbucks resolve only to verified HTTPS balance destinations", () => {
  const target = getRetailerVerification("target");
  const starbucks = getRetailerVerification("starbucks");
  assert.equal(target.verificationMethod, "OFFICIAL_WEBSITE");
  assert.equal(target.officialDomain, "www.target.com");
  assert.equal(approvedOfficialBalanceUrl("target"), "https://www.target.com/guest/gift-card-balance");
  assert.equal(starbucks.verificationMethod, "OFFICIAL_WEBSITE");
  assert.equal(starbucks.officialDomain, "www.starbucks.com");
  assert.equal(approvedOfficialBalanceUrl("starbucks"), "https://www.starbucks.com/gift/card/manage");
  assert.equal(target.authorizedProvider, null);
  assert.equal(starbucks.authorizedProvider, null);
});

test("unknown retailers default to disabled manual-only without a guessed URL", () => {
  const retailer = getRetailerVerification("custom-bookshop");
  assert.equal(retailer.verificationMethod, "MANUAL_ONLY");
  assert.equal(retailer.enabled, false);
  assert.equal(retailer.officialBalanceUrl, "");
  assert.equal(approvedOfficialBalanceUrl("custom-bookshop"), "");
});

test("provider results require explicit success and exact currency/minor-unit bounds", () => {
  assert.deepEqual(
    validateNormalizedProviderResult({ status: "success", balanceMinor: 1250, currency: "USD" }, "USD", 10000),
    { balanceMinor: 1250, currency: "USD" },
  );
  assert.throws(() => validateNormalizedProviderResult({ status: "refused", balanceMinor: 1250, currency: "USD" }, "USD", 10000), /provider_refused/);
  assert.throws(() => validateNormalizedProviderResult({ status: "success", balanceMinor: 1250, currency: "EUR" }, "USD", 10000), /invalid_provider_response/);
  assert.throws(() => validateNormalizedProviderResult({ status: "success", balanceMinor: 12.5, currency: "USD" }, "USD", 10000), /invalid_provider_response/);
  assert.throws(() => validateNormalizedProviderResult({ status: "success", balanceMinor: 10001, currency: "USD" }, "USD", 10000), /invalid_provider_response/);
});

test("provider adapters remain fail-closed and expose only safe error categories", async () => {
  for (const adapter of Object.values(CARD_BALANCE_PROVIDERS)) {
    assert.equal(adapter.supportsCard({ retailer: "target", cardType: "physical", currency: "USD" }), false);
    await assert.rejects(adapter.checkBalance({}), /provider_not_configured/);
  }
  assert.equal(getCardBalanceProvider("unrecognized"), null);
  assert.equal(safeProviderErrorCategory("provider rejected with private data"), "unknown");
  assert.match(ADYEN_TEST_ADAPTER_STATUS, /disabled by default/i);
});

test("Adyen TEST helper builds the documented request and parses minor-unit responses", () => {
  const syntheticTestNumber = "9".repeat(16);
  const request = buildAdyenCheckBalanceRequest({
    merchantAccount: "approved-test-merchant",
    reference: "verification-request-id",
    storedValueType: "svs",
    credentials: { number: syntheticTestNumber, securityCode: "1234" },
  });
  assert.deepEqual(request, {
    merchantAccount: "approved-test-merchant",
    reference: "verification-request-id",
    paymentMethod: { type: "svs", number: syntheticTestNumber, securityCode: "1234" },
  });
  assert.deepEqual(
    parseAdyenCheckBalanceResponse({
      resultCode: "Success",
      currentBalance: { currency: "USD", value: 1250 },
    }, "USD", 10000),
    { status: "success", balanceMinor: 1250, currency: "USD", testData: true },
  );
  assert.throws(() => buildAdyenCheckBalanceRequest({
    merchantAccount: "approved-test-merchant",
    reference: "verification-request-id",
    storedValueType: "givex",
    credentials: { number: syntheticTestNumber },
  }), /unsupported_card_type/);
  assert.throws(() => parseAdyenCheckBalanceResponse({
    resultCode: "Refused",
    currentBalance: { currency: "USD", value: 0 },
  }, "USD", 10000), /provider_refused/);
  assert.throws(() => parseAdyenCheckBalanceResponse({
    resultCode: "Success",
    currentBalance: { currency: "JPY", value: 100 },
  }, "JPY", 10000), /unsupported_currency/);
});

test("Adyen TEST adapter refuses redirects and reports refusal and timeout safely", async () => {
  const credentials = { number: "9".repeat(16), securityCode: "9999" };
  const configuration = {
    enabled: true,
    schemaVerified: true,
    apiKey: "fake-api-key-in-memory",
    merchantAccount: "fake-test-merchant",
    apiVersion: "0",
    storedValueType: "svs",
  };
  const card = { card_type: "physical", currency: "USD", original_value: "20.00" };
  let fetchOptions;
  const adapter = createAdyenTestAdapter(configuration, async (url, options) => {
    fetchOptions = { url, ...options };
    return new Response(JSON.stringify({
      resultCode: "Success",
      currentBalance: { currency: "USD", value: 1250 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const result = await adapter.checkBalance({ card, credentials, requestId: "test-request-123" });
  assert.deepEqual(result, { status: "success", balanceMinor: 1250, currency: "USD", testData: true });
  assert.equal(fetchOptions.redirect, "error");
  assert.match(fetchOptions.url, /^https:\/\/pal-test\.adyen\.com\/pal\/servlet\/StoredValue\/v0\/checkBalance$/);
  const request = JSON.parse(fetchOptions.body);
  assert.deepEqual(Object.keys(request).sort(), ["merchantAccount", "paymentMethod", "reference"]);
  assert.deepEqual(Object.keys(request.paymentMethod).sort(), ["number", "securityCode", "type"]);

  const redirected = createAdyenTestAdapter(configuration, async (_url, options) => {
    assert.equal(options.redirect, "error");
    throw new TypeError("redirect blocked");
  });
  await assert.rejects(
    redirected.checkBalance({ card, credentials, requestId: "redirect-request-123" }),
    /provider_refused/,
  );

  const timeoutAdapter = createAdyenTestAdapter(configuration, (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
  }), 5);
  await assert.rejects(
    timeoutAdapter.checkBalance({ card, credentials, requestId: "timeout-request-123" }),
    /provider_timeout/,
  );
});

test("Edge Function authenticates, scopes card ownership, requires consent, and allowlists inputs", () => {
  assert.match(config, /\[functions\.check-card-balance\]\s+verify_jwt = true/);
  assert.match(functionSource, /authenticatedUser\(request\)/);
  assert.match(functionSource, /\.eq\("owner_id", context\.user\.id\)/);
  assert.match(functionSource, /body\.consent !== true/);
  assert.match(functionSource, /\["card_id", "request_id", "consent"\]/);
  assert.doesNotMatch(functionSource, /card_number|security_code|console\.(log|error)/i);
  assert.match(functionSource, /begin_card_balance_verification/);
  assert.match(functionSource, /complete_card_balance_verification/);
});

test("migration retains client write restrictions and isolates verification records", () => {
  assert.match(migration, /balance_verification_status in \([\s\S]*?'UNVERIFIED'[\s\S]*?'USER_REPORTED'[\s\S]*?'PROVIDER_VERIFIED'[\s\S]*?'RECHECK_REQUIRED'[\s\S]*?'VERIFICATION_FAILED'/);
  assert.match(migration, /create policy balance_verification_attempts_select_own[\s\S]*?owner_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /grant execute on function public\.begin_card_balance_verification[\s\S]*?to authenticated/i);
  assert.match(migration, /revoke all on function public\.complete_card_balance_verification[\s\S]*?from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.complete_card_balance_verification[\s\S]*?to service_role/i);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /created_at > now\(\) - interval '1 minute'/);
  assert.match(migration, /unique \(owner_id, request_id\)/);
  assert.match(migration, /new\.verification_status := 'unverified'/);
  assert.match(migration, /new\.balance_verification_status := 'USER_REPORTED'/);
  assert.match(migration, /new\.verified_at is not distinct from old\.verified_at/);
  assert.match(migration, /new\.verified_at is distinct from old\.verified_at/);
});

test("wallet clients invoke verification with only a card ID, request ID, and explicit consent", () => {
  assert.match(wallet, /functions\.invoke\("check-card-balance"/);
  assert.match(wallet, /body: \{ card_id: cardId, request_id: crypto\.randomUUID\(\), consent: true \}/);
  assert.doesNotMatch(wallet, /body:[^\n]*(card_number|security_code|balance|provider)/i);
  assert.match(ui, /Check on \$\{esc\(retailerLabel\)\}'s Website/);
  assert.match(ui, /referrerpolicy="no-referrer"/);
  assert.match(ui, /Confirm \$\{esc\(retailerLabel\)\} is the issuer/);
  assert.match(ui, /retailerConfirmed\) e\.retailerConfirmed/);
  assert.match(ui, /result\?\.test_data[\s\S]*?TEST result only/);
});

test("Ruby reads safe verification metadata and the Android APK job is manual", () => {
  assert.match(ruby, /latest_provider_confirmed_balance_minor/);
  assert.match(ruby, /latest_provider_confirmed_at/);
  assert.match(ruby, /automatic_verification_available/);
  assert.match(ruby, /verification_error_category/);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /assembleDebug/);
  assert.match(workflow, /upload-artifact@v4/);
  assert.match(setup, /check-card-balance/);
});
