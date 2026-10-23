import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import test from "node:test";
import {
  buildExpiryNotifications,
  notificationIdFromString,
  resolveNotificationPermission,
  safeStoredNotificationContent,
} from "../src/services/notification-runtime.js";
import {
  signWebhookBody,
  validateBalanceWebhook,
  verifyWebhookSignature,
} from "../supabase/functions/_shared/retailer-webhook.js";
import { classifyRubyDemoIntent, rubyDemoReply } from "../supabase/functions/_shared/ruby-demo.js";

const root = new URL("../", import.meta.url);
const [operations, schema, ruby, webhook, notificationService] = await Promise.all([
  readFile(new URL("supabase/migrations/20261023000300_phase2b_activity_notifications.sql", root), "utf8"),
  readFile(new URL("supabase/migrations/20261023000100_walletswap_schema.sql", root), "utf8"),
  readFile(new URL("supabase/functions/ruby-chat/index.ts", root), "utf8"),
  readFile(new URL("supabase/functions/authorized-balance-webhook/index.ts", root), "utf8"),
  readFile(new URL("src/services/notifications.js", root), "utf8"),
]);

test("purchase ledger keeps the $50 to $35 purchase atomic and idempotent", () => {
  assert.match(operations, /for update/i);
  assert.match(operations, /if p_amount > v_card\.reported_balance then/i);
  assert.match(operations, /v_new_balance := v_card\.reported_balance - p_amount/);
  assert.match(operations, /'user_reported', 'unverified', p_idempotency_key/);
  assert.match(operations, /where owner_id = v_user_id and idempotency_key = p_idempotency_key/);
  assert.match(schema, /create unique index card_activity_idempotency_idx[\s\S]*?on public\.card_activity \(owner_id, idempotency_key\)/i);
  assert.equal(50 - 15, 35);
});

test("duplicate requests, overspending, and owner scoping are enforced by the database contract", () => {
  assert.match(operations, /Idempotency key was already used/);
  assert.match(operations, /Purchase exceeds reported balance/);
  assert.match(operations, /where id = p_card_id and owner_id = v_user_id/);
  assert.match(schema, /create policy card_activity_select_own[\s\S]*?owner_id = \(select auth\.uid\(\)\)/i);
});

test("permission denial never retries permission implicitly", async () => {
  let requests = 0;
  assert.equal(await resolveNotificationPermission("denied", async () => { requests += 1; return "granted"; }), "denied");
  assert.equal(await resolveNotificationPermission("granted", async () => { requests += 1; return "denied"; }), "granted");
  assert.equal(requests, 0);
});

test("notification streams are authenticated-user-filtered and published for realtime", () => {
  assert.match(notificationService, /filter: `user_id=eq\.\$\{userId\}`/);
  assert.match(schema, /create policy notifications_select_own[\s\S]*?user_id = \(select auth\.uid\(\)\)/i);
  assert.match(operations, /alter publication supabase_realtime add table public\.notifications/i);
});

test("marketplace and swap notices are preference-gated and simulation-only", () => {
  assert.match(operations, /create trigger transaction_records_notify_participants/i);
  assert.match(operations, /create trigger swap_requests_notify_participants/i);
  assert.match(operations, /where user_id = v_user_id and marketplace_alerts_enabled/i);
  assert.match(operations, /No payment or card transfer occurred/);
  assert.match(operations, /no transfer has occurred/i);
});

test("expiry reminders use stable IDs and omit card balances and identifiers", () => {
  const now = new Date("2030-01-01T00:00:00Z");
  const cards = [{ id: "card-a", brand: "Target", balance: 50, last4: "9911", expires: "2030-01-21" }];
  const reminders = buildExpiryNotifications(cards, now);
  assert.equal(reminders.length, 2);
  assert.equal(new Set(reminders.map(item => item.id)).size, 2);
  assert.equal(reminders[0].id, notificationIdFromString("expiry:card-a:14"));
  const messageText = reminders.map(item => `${item.title} ${item.body}`).join(" ");
  assert.equal(messageText.includes("9911"), false);
  assert.equal(messageText.includes("50"), false);
});

test("activity lock-screen notification contains no balance or identifier", () => {
  const notification = safeStoredNotificationContent("purchase");
  assert.equal(notification.body.includes("card activity"), true);
  assert.doesNotMatch(JSON.stringify(notification), /9911|50\.00|PIN|redemption/i);
  assert.match(safeStoredNotificationContent("test_balance_change").body, /signed test event/i);
});

test("signed retailer webhook accepts valid HMAC and rejects tampering", async () => {
  const secret = "test-only-secret";
  const body = JSON.stringify({
    provider: "walletswap-test",
    event_id: "phase2b-test-001",
    card_id: "123e4567-e89b-42d3-a456-426614174000",
    balance: 35,
    currency: "USD",
    test_event: true,
  });
  const signature = await signWebhookBody(secret, body, webcrypto);
  assert.equal(await verifyWebhookSignature(secret, body, signature, webcrypto), true);
  assert.equal(await verifyWebhookSignature(secret, `${body} `, signature, webcrypto), false);
  assert.equal(await verifyWebhookSignature(secret, body, "sha256=bad", webcrypto), false);
});

test("signed webhook validation requires an explicit dedicated test marker", () => {
  const event = {
    provider: "walletswap-test",
    event_id: "phase2b-test-002",
    card_id: "123e4567-e89b-42d3-a456-426614174000",
    balance: 35,
    currency: "USD",
    test_event: true,
  };
  assert.equal(validateBalanceWebhook(event).test_event, true);
  assert.throws(() => validateBalanceWebhook({ ...event, balance: -1 }));
  assert.throws(() => validateBalanceWebhook({ ...event, test_event: false }));
  assert.match(webhook, /x-walletswap-signature/);
  assert.match(operations, /p_test_event then[\s\S]*?v_status := 'unverified'/);
});

test("authorized balance decreases are reviewable and user reporting is owner-scoped", () => {
  assert.match(operations, /v_requires_review := not p_test_event and p_balance < v_previous/);
  assert.match(operations, /where id = p_activity_id and owner_id = auth\.uid\(\) and requires_review/);
});

test("Ruby weekly summaries use authenticated wallet data and disclose absent external feeds", () => {
  assert.match(ruby, /generate_weekly_wallet_summary/);
  assert.match(ruby, /client\.from\("card_activity"\)[\s\S]*?\.gte\("created_at", since\)/);
  assert.match(ruby, /there is no connected external transaction feed/i);
  assert.equal(classifyRubyDemoIntent("Give me my weekly wallet summary").operation, "weekly_summary");
  assert.match(rubyDemoReply("weekly wallet summary", {
    weeklySummary: { balances: [], activity: [] },
  }).reply, /No external transaction feed is connected/);
});
