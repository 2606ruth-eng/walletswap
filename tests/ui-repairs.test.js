import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildDeletionRequestUrl } from "../src/account-deletion.js";
import { HELP_STEPS } from "../src/help-tour.js";
import { isNearScrollEnd, scrollToLatest } from "../src/ruby-scroll.js";
import { customRetailerId, normalizeRetailerSelection, rankRecentlyUsedRetailers } from "../src/retailer-preferences.js";
import {
  getFavoriteRetailers,
  retailerFavoritesErrorMessage,
  setFavoriteRetailer,
} from "../src/services/retailer-favorites.js";
import {
  getNotificationPreferences,
  notificationPreferenceErrorMessage,
  updateNotificationPreferences,
} from "../src/services/notifications.js";

const source = await readFile(new URL("../index.html", import.meta.url), "utf8");
const favoritesMigration = await readFile(new URL("../supabase/migrations/20261028000500_retailer_favorites.sql", import.meta.url), "utf8");

function fakeFavoritesClient({ user = { id: "user-a" }, rows = [], failure = null } = {}) {
  const calls = [];
  return {
    calls,
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from(table) {
      calls.push({ method: "from", table });
      return {
        select(columns) {
          calls.push({ method: "select", columns });
          return {
            eq(column, value) {
              calls.push({ method: "eq", column, value });
              return {
                order() {
                  return Promise.resolve({ data: rows, error: failure });
                },
              };
            },
          };
        },
        insert(payload) {
          calls.push({ method: "insert", payload });
          return Promise.resolve({ error: failure });
        },
        delete() {
          calls.push({ method: "delete" });
          return {
            eq(column, value) {
              calls.push({ method: "eq", column, value });
              return {
                eq(nextColumn, nextValue) {
                  calls.push({ method: "eq", column: nextColumn, value: nextValue });
                  return Promise.resolve({ error: failure });
                },
              };
            },
          };
        },
      };
    },
  };
}

test("recent retailers rank unique authenticated activity and allow safe custom names", () => {
  const recents = rankRecentlyUsedRetailers([
    { brand: "amazon", t: 10, kind: "added" },
    { brand: "amazon", t: 30, kind: "redeemed" },
    { brand: "starbucks", t: 20, kind: "added" },
    { brand: "target", t: 50, kind: "removed" },
    { brand: "other", brandName: "Local & Co.", t: 25, kind: "added" },
  ], 2);
  assert.deepEqual(recents.map(item => item.retailer), ["amazon", "custom-local-co"]);
  assert.equal(recents[1].displayName, "Local & Co.");
  assert.deepEqual(normalizeRetailerSelection("other", " A\nShop "), {
    retailer: "custom-a-shop",
    displayName: "A Shop",
  });
  assert.equal(customRetailerId("***"), "");
});

test("favorite retailer reads and writes are scoped to the authenticated user", async () => {
  const client = fakeFavoritesClient({ rows: [{ retailer: "amazon", display_name: "Amazon" }] });
  assert.deepEqual(await getFavoriteRetailers(client), [{ retailer: "amazon", display_name: "Amazon" }]);
  assert.ok(client.calls.some(call => call.method === "eq" && call.column === "user_id" && call.value === "user-a"));

  await setFavoriteRetailer({ retailer: "target", displayName: "Target", pinned: true }, client);
  assert.ok(client.calls.some(call => call.method === "insert" && call.payload.user_id === "user-a"));
  await setFavoriteRetailer({ retailer: "target", displayName: "Target", pinned: false }, client);
  assert.ok(client.calls.some(call => call.method === "eq" && call.column === "user_id" && call.value === "user-a"));
});

test("favorite retailer service rejects unauthenticated access and reports unapplied migration", async () => {
  const client = fakeFavoritesClient({ user: null });
  await assert.rejects(getFavoriteRetailers(client), /Sign in/);
  assert.equal(client.calls.length, 0);
  assert.match(retailerFavoritesErrorMessage({ code: "42P01" }), /migration is applied/);
  const duplicate = fakeFavoritesClient({ failure: { code: "23505" } });
  await setFavoriteRetailer({ retailer: "amazon", displayName: "Amazon", pinned: true }, duplicate);
});

test("favorite retailer storage remains per-user under row-level security", () => {
  assert.match(favoritesMigration, /enable row level security/i);
  assert.match(favoritesMigration, /using \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(favoritesMigration, /with check \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(favoritesMigration, /primary key \(user_id, retailer\)/i);
});

test("notification preferences are persisted with authenticated user scoping", async () => {
  const calls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-b" } }, error: null }) },
    from(table) {
      calls.push(["from", table]);
      return {
        update(payload) {
          calls.push(["update", payload]);
          return {
            eq(column, value) {
              calls.push(["eq", column, value]);
              return {
                select() {
                  return { maybeSingle: async () => ({ data: { user_id: "user-b" }, error: null }) };
                },
              };
            },
          };
        },
      };
    },
  };
  await updateNotificationPreferences({ card_activity_enabled: false, unsupported: true }, client);
  assert.deepEqual(calls, [
    ["from", "notification_preferences"],
    ["update", { card_activity_enabled: false }],
    ["eq", "user_id", "user-b"],
  ]);
  assert.match(notificationPreferenceErrorMessage({ code: "42501" }), /Sign in again/);
});

test("notification preferences can be read after reload using the authenticated RLS context", async () => {
  const expected = {
    card_activity_enabled: false,
    balance_change_enabled: true,
    expiry_reminders_enabled: false,
    weekly_summary_enabled: true,
    marketplace_alerts_enabled: false,
  };
  const calls = [];
  const client = {
    from(table) {
      calls.push(["from", table]);
      return {
        select(columns) {
          calls.push(["select", columns]);
          return {
            maybeSingle: async () => ({ data: expected, error: null }),
          };
        },
      };
    },
  };
  assert.deepEqual(await getNotificationPreferences(client), expected);
  assert.deepEqual(calls, [
    ["from", "notification_preferences"],
    ["select", "card_activity_enabled,balance_change_enabled,expiry_reminders_enabled,weekly_summary_enabled,marketplace_alerts_enabled"],
  ]);
});

test("deletion request URL requires account email and explicitly remains a request", () => {
  assert.throws(() => buildDeletionRequestUrl("not-an-email"), /account/);
  const url = new URL(buildDeletionRequestUrl("person@example.com"));
  assert.equal(url.protocol, "mailto:");
  assert.equal(url.pathname, "admin@walletswap.org");
  assert.match(decodeURIComponent(url.searchParams.get("body")), /does not mean deletion is already complete|not deleted until WalletSwap confirms/);
  assert.match(source, /data-act="deletion-continue"/);
  assert.match(source, /data-form="deletion-request"/);
});

test("Ruby scroll helper follows the real screen viewport and detects older-message reading", () => {
  const viewport = { scrollHeight: 1200, scrollTop: 400, clientHeight: 500, scrollTo(options) { this.scrollTop = options.top; } };
  assert.equal(isNearScrollEnd(viewport), false);
  assert.equal(scrollToLatest(viewport), true);
  assert.equal(viewport.scrollTop, 1200);
  assert.equal(isNearScrollEnd(viewport), true);
  assert.match(source, /scrollToLatest\(\$\("#screen"\)/);
});

test("help tour explains every feature without implying unsupported live functionality", () => {
  assert.equal(HELP_STEPS.length, 8);
  assert.ok(HELP_STEPS.some(step => /remaining balance/i.test(step.body)));
  assert.ok(HELP_STEPS.some(step => /cannot verify/i.test(step.body)));
  assert.ok(HELP_STEPS.some(step => /does not collect payment or transfer/i.test(step.body)));
  for (const action of ["tutorial-open", "tutorial-skip", "tutorial-back", "tutorial-next", "tutorial-close"]) {
    assert.ok(source.includes(`"${action}"`), `missing tutorial action ${action}`);
  }
});

test("WalletSwap keeps scanner suggestions reviewable and moves account deletion into Settings", () => {
  assert.match(source, /capture-apply-scan/);
  assert.match(source, /capture-apply-ocr/);
  assert.match(source, /Remaining balance: not read — enter it yourself/);
  assert.match(source, /case "settings": body = vSettings/);
  assert.match(source, /href="#\/app\/settings\/account\/delete"/);
  assert.doesNotMatch(source, /data-act="sheet" data-s="delete">Delete account/);
  assert.match(source, /body:not\(\.in-app\)::before/);
  assert.match(source, /body\.in-app::before\{display:none\}/);
});
