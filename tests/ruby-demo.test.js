import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyRubyDemoIntent, rubyDemoReply } from "../supabase/functions/_shared/ruby-demo.js";
import { rubyErrorMessage } from "../src/services/ruby.js";

const [edgeSource, indexSource, rubyService] = await Promise.all([
  readFile(new URL("../supabase/functions/ruby-chat/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/services/ruby.js", import.meta.url), "utf8"),
]);

const card = {
  id: "owned-card",
  retailer: "starbucks",
  nickname: "Birthday",
  reported_balance: "30.00",
  currency: "USD",
  verification_status: "unverified",
};

test("Ruby Demo Mode maps supported wallet requests to actual data operations", () => {
  assert.equal(classifyRubyDemoIntent("What gift cards do I have?").operation, "cards");
  assert.deepEqual(classifyRubyDemoIntent("Which cards expire in 14 days?"), { operation: "expiring", days: 14 });
  assert.equal(classifyRubyDemoIntent("Review recent activity").operation, "activity");
  assert.equal(classifyRubyDemoIntent("Find me a swap for Starbucks").operation, "swap");
  assert.deepEqual(classifyRubyDemoIntent("How much would I receive if I sold a $30 card?"), {
    operation: "sale_estimate", amount: "30",
  });
});

test("Demo wallet answers identify reported and verification status without combining currencies", () => {
  const reply = rubyDemoReply("What gift cards do I have?", { cards: [card] });
  assert.equal(reply.mode, "demo");
  assert.match(reply.reply, /starbucks/);
  assert.match(reply.reply, /USD 30\.00 reported \(unverified\)/);

  const summary = rubyDemoReply("How much money do I have?", {
    summary: [
      { currency: "USD", card_count: 1, reported_balance: "30.00", verified_balance: "0.00" },
      { currency: "EUR", card_count: 1, reported_balance: "10.00", verified_balance: "10.00" },
    ],
  }).reply;
  assert.match(summary, /USD: USD 30\.00/);
  assert.match(summary, /EUR: EUR 10\.00/);
  assert.match(summary, /not combined/);
  assert.doesNotMatch(summary, /40\.00/);
});

test("Demo pricing is deterministic and uses the card's real reported balance", () => {
  const result = rubyDemoReply("How much would I receive if I sold a $30 card?", { cards: [card] });
  assert.match(result.reply, /asking price USD 27\.00/);
  assert.match(result.reply, /fee USD 1\.35/);
  assert.match(result.reply, /estimated payout USD 25\.65/);
  assert.match(result.reply, /unverified/);
  assert.match(result.reply, /does not create a listing/);

  const absent = rubyDemoReply("How much would I receive if I sold a $100 card?", { cards: [card] });
  assert.match(absent.reply, /couldn't find an active card/);
});

test("Demo Mode refuses to claim balance verification or fabricate marketplace matches", () => {
  assert.match(rubyDemoReply("Can you verify my gift-card balance?").reply, /can't independently verify/);
  assert.match(rubyDemoReply("Find a swap for Starbucks", { matches: [] }).reply, /couldn't find an eligible matching listing/);
  assert.match(rubyDemoReply("Find a swap for Starbucks").reply, /Tell me which retailer card/);
});

test("Ruby backend never falls back to simulated answers when live mode is unavailable", () => {
  assert.match(edgeSource, /authenticatedUser\(request\)/);
  assert.match(edgeSource, /Deno\.env\.get\("RUBY_AI_MODE"\) !== "live"/);
  assert.doesNotMatch(edgeSource, /liveAiEnabled|demoReply|rubyDemoReply/);
  assert.match(edgeSource, /temporarily unavailable/);
  assert.match(edgeSource, /persistConversation\(client, admin, user\.id/);
  assert.match(edgeSource, /mode: "live_ai"/);
  assert.match(edgeSource, /client\.from\("wallet_cards"\)/);
  assert.match(indexSource, /Check My Wallet/);
  assert.match(indexSource, /What Cards Do I Have\?/);
  assert.match(indexSource, /Cards Expiring Soon/);
  assert.match(indexSource, /Find Me a Swap/);
  assert.match(indexSource, /Help Me Sell a Card/);
  assert.match(indexSource, /Review Recent Activity/);
  assert.match(rubyService, /export async function deleteRubyConversation/);
  assert.match(indexSource, /await deleteRubyConversation\(conversationId\)/);
  assert.match(indexSource, /ruby: \{ userId: "", loadedFor: "", conversations: \[\], conversationId: "", messages: \[\]/);
  assert.match(indexSource, /ui\.ruby\.draft = `Help me review my \$\{brandName\(card\)\} card\.`/);
});

test("Ruby explains both per-minute and monthly usage limits without implying payment", () => {
  assert.match(rubyErrorMessage({ status: 429 }), /request or monthly usage cap/);
  assert.match(rubyErrorMessage({ status: 503 }), /temporarily unavailable/);
});
