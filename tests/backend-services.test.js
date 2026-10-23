import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readLegacyAccount } from "../src/services/migration.js";
import { mapWalletCard, walletCardInsertPayload, dollarsToCents, centsToDecimal } from "../src/services/wallet.js";
import { validateSupabaseConfig } from "../src/services/supabase.js";

const [walletActionSource, marketplaceActionSource, rubySource] = await Promise.all([
  readFile(new URL("../supabase/functions/wallet-actions/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/marketplace-actions/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/ruby-chat/index.ts", import.meta.url), "utf8"),
]);

test("Supabase configuration accepts a publishable HTTPS endpoint and rejects secrets", () => {
  assert.deepEqual(validateSupabaseConfig({
    url: "https://walletswap.supabase.co",
    publishableKey: "sb_publishable_example",
  }), { configured: true, error: "" });
  assert.equal(validateSupabaseConfig({
    url: "https://walletswap.supabase.co",
    publishableKey: "sb_secret_do_not_use",
  }).configured, false);
  assert.equal(validateSupabaseConfig({
    url: "http://walletswap.supabase.co",
    publishableKey: "publishable",
  }).configured, false);
});

test("wallet amounts convert to integer-safe cents", () => {
  assert.equal(dollarsToCents("$1,234.56"), 123456);
  assert.equal(centsToDecimal(123456), "1234.56");
  assert.throws(() => dollarsToCents("1.999"));
  assert.throws(() => centsToDecimal(-1));
});

test("wallet card payload keeps credentials out of the backend request shape", () => {
  const payload = walletCardInsertPayload({
    brand: "target",
    nickname: "Birthday",
    type: "Physical",
    currency: "USD",
    original: 50,
    balance: 20,
    expires: "",
    last4: "1234",
    number: "4111111111111234",
    pin: "9876",
  }, "user-id");

  assert.deepEqual(payload, {
    owner_id: "user-id",
    retailer: "target",
    nickname: "Birthday",
    card_type: "physical",
    currency: "USD",
    original_value: "50.00",
    reported_balance: "20.00",
    expiration_date: null,
    masked_identifier: "1234",
  });
  assert.equal("number" in payload, false);
  assert.equal("pin" in payload, false);
});

test("remote card mapping never restores a complete card number or PIN", () => {
  const card = mapWalletCard({
    id: "card-id", retailer: "target", nickname: "Gift", card_type: "physical", currency: "USD",
    original_value: "50.00", reported_balance: "20.00", expiration_date: null,
    masked_identifier: "••••1234", verification_status: "unverified", verification_source: null,
    verified_at: null, last_activity_at: "2026-10-23T00:00:00Z", archived_at: null,
    created_at: "2026-10-22T00:00:00Z", updated_at: "2026-10-22T00:00:00Z",
  });
  assert.equal(card.number, "");
  assert.equal(card.pin, "");
  assert.equal(card.last4, "1234");
  assert.equal(card.balanceVerification, "user-reported");
});

test("legacy import only maps non-demo metadata and excludes credentials", () => {
  const storage = {
    getItem(key) {
      assert.equal(key, "walletswap.state.v1");
      return JSON.stringify({
        accounts: {
          "demo@walletswap.app": {
            email: "demo@walletswap.app", demo: true,
            data: { cards: [{ brand: "amazon", number: "4111111111111111", pin: "1234", original: 20, balance: 10 }] },
          },
          "person@example.com": {
            email: "person@example.com", demo: false,
            data: { cards: [{ brand: "target", type: "Physical", number: "4111111111111234", pin: "9876", last4: "1234", original: 50, balance: 20 }] },
          },
        },
      });
    },
  };
  const account = readLegacyAccount("person@example.com", storage);
  assert.equal(account.cards.length, 1);
  assert.deepEqual(account.cards[0], {
    retailer: "target",
    nickname: "",
    card_type: "physical",
    currency: "USD",
    original_value: "50.00",
    reported_balance: "20.00",
    expiration_date: null,
    masked_identifier: "1234",
  });
  assert.equal(readLegacyAccount("demo@walletswap.app", storage), null);
});

test("Edge Function actions avoid persisting user-supplied spend descriptions", () => {
  assert.match(walletActionSource, /p_description:\s*"User-recorded purchase"/);
  assert.doesNotMatch(walletActionSource, /p_description:\s*typeof body\.description/);
});

test("marketplace Edge Function supports server-validated user asking prices", () => {
  assert.match(marketplaceActionSource, /p_asking_price:\s*body\.askingPrice/);
  assert.match(marketplaceActionSource, /body\.askingPrice === undefined/);
});

test("Ruby conversation references are checked through authenticated row-level access", () => {
  assert.match(rubySource, /from\("ruby_conversations"\)[\s\S]*?eq\("id", activeConversationId\)/);
});
