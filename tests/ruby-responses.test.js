import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  conversationInput,
  responseFunctionCalls,
  responseText,
  toResponsesTools,
} from "../supabase/functions/_shared/ruby-responses.js";
import {
  estimateRubyCostMicros,
  rubyCostConfiguration,
  rubyUsageFromResponse,
} from "../supabase/functions/_shared/ruby-usage.js";

const edgeFunction = await readFile(new URL("../supabase/functions/ruby-chat/index.ts", import.meta.url), "utf8");
const usageMigration = await readFile(new URL("../supabase/migrations/20261023000400_ruby_usage_controls.sql", import.meta.url), "utf8");

test("Ruby tool definitions use the Responses API function-tool shape", () => {
  const result = toResponsesTools([{
    type: "function",
    function: {
      name: "get_wallet_summary",
      description: "Summarize the authenticated wallet.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  }]);

  assert.deepEqual(result, [{
    type: "function",
    name: "get_wallet_summary",
    description: "Summarize the authenticated wallet.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  }]);
});

test("Responses tools convert optional arguments to nullable strict-schema required fields", () => {
  const [tool] = toResponsesTools([{
    type: "function",
    function: {
      name: "get_expiring_cards",
      description: "List expiry dates.",
      parameters: {
        type: "object",
        properties: { days: { type: "integer" } },
        required: [],
        additionalProperties: false,
      },
    },
  }]);
  assert.deepEqual(tool.parameters, {
    type: "object",
    properties: { days: { type: ["integer", "null"] } },
    required: ["days"],
    additionalProperties: false,
  });
  assert.equal(tool.strict, true);
});

test("Responses API conversation input includes stored history and the new user turn", () => {
  assert.deepEqual(conversationInput([
    { role: "user", content: "What cards do I have?" },
    { role: "assistant", content: "I can check your wallet." },
  ], "Please check."), [
    { role: "user", content: "What cards do I have?" },
    { role: "assistant", content: "I can check your wallet." },
    { role: "user", content: "Please check." },
  ]);
});

test("Responses API function calls expose call ids, names, and JSON arguments", () => {
  assert.deepEqual(responseFunctionCalls({
    output: [
      { type: "reasoning", id: "reasoning-1" },
      { type: "function_call", call_id: "call-1", name: "get_card_details", arguments: "{\"card_id\":\"card-id\"}" },
    ],
  }), [{
    callId: "call-1",
    name: "get_card_details",
    arguments: "{\"card_id\":\"card-id\"}",
  }]);
});

test("Responses API final text supports the convenience field and message output items", () => {
  assert.equal(responseText({ output_text: "Your wallet has two cards." }), "Your wallet has two cards.");
  assert.equal(responseText({ output: [{
    type: "message",
    content: [{ type: "output_text", text: "Your balance is user-reported." }],
  }] }), "Your balance is user-reported.");
});

test("Ruby uses authenticated Responses API calls and stores conversation messages", () => {
  assert.match(edgeFunction, /authenticatedUser\(request\)/);
  assert.match(edgeFunction, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.doesNotMatch(edgeFunction, /chat\/completions/);
  assert.match(edgeFunction, /function_call_output/);
  assert.match(edgeFunction, /from\("ruby_conversations"\)/);
  assert.match(edgeFunction, /from\("ruby_messages"\)/);
  assert.match(edgeFunction, /Deno\.env\.get\("OPENAI_API_KEY"\)/);
  assert.match(edgeFunction, /model: costConfig\.model/);
  assert.match(edgeFunction, /store: false/);
  assert.match(edgeFunction, /get_notification_preferences/);
  assert.match(edgeFunction, /get_recent_notifications/);
});

test("Ruby wallet list is fetched through the authenticated client and excludes credentials", () => {
  assert.match(edgeFunction, /get_wallet_cards/);
  assert.match(edgeFunction, /client\.from\("wallet_cards"\)[\s\S]*?masked_identifier,verification_status/);
  assert.doesNotMatch(edgeFunction, /card_number|redemption_code|security_code/);
});

test("Ruby fails closed on auth, validates bounded request data, and limits provider spend", () => {
  assert.match(edgeFunction, /if \(!context\) return jsonResponse\(request, 401/);
  assert.match(edgeFunction, /MAX_REQUEST_BYTES = 16_000/);
  assert.match(edgeFunction, /MAX_HISTORY_CHARS = 8000/);
  assert.match(edgeFunction, /REQUESTS_PER_MINUTE = 5/);
  assert.match(edgeFunction, /p_max_requests: REQUESTS_PER_MINUTE/);
  assert.match(edgeFunction, /MAX_OUTPUT_TOKENS = 600/);
  assert.match(edgeFunction, /max_output_tokens: MAX_OUTPUT_TOKENS/);
  assert.match(edgeFunction, /SENSITIVE_VALUE\.test\(responseText\)/);
  assert.match(edgeFunction, /rejectDisallowedOrigin\(request\)/);
  assert.match(edgeFunction, /signal: AbortSignal\.timeout\(20000\)/);
  assert.match(edgeFunction, /RUBY_MONTHLY_BUDGET_USD/);
  assert.match(edgeFunction, /reserve_ruby_ai_budget/);
  assert.match(edgeFunction, /settle_ruby_ai_budget/);
  assert.match(edgeFunction, /MAX_RESERVED_INPUT_TOKENS = 512_000/);
  assert.doesNotMatch(edgeFunction, /demoReply|rubyDemoReply|classifyRubyDemoIntent/);
  assert.match(edgeFunction, /Ruby Live AI is not enabled on the server/);
});

test("Ruby provider failures and unsafe output never switch to simulated replies", () => {
  assert.match(edgeFunction, /if \(providerStatus !== null\)[\s\S]*?temporarily unavailable/);
  assert.match(edgeFunction, /could not produce a safe response/);
  assert.doesNotMatch(edgeFunction, /modeLabel|Demo Mode/);
});

test("Ruby model prices and budget are server-configurable and capped at $100 per month", () => {
  const config = rubyCostConfiguration({
    RUBY_OPENAI_MODEL: "gpt-example",
    RUBY_INPUT_COST_PER_MILLION_USD: "0.15",
    RUBY_OUTPUT_COST_PER_MILLION_USD: "0.60",
    RUBY_MONTHLY_BUDGET_USD: "25.00",
  });
  assert.equal(config.model, "gpt-example");
  assert.equal(config.monthlyLimit, 25_000_000n);
  assert.equal(estimateRubyCostMicros(1_000_000, 1_000_000, config), 750_000n);
  assert.equal(rubyCostConfiguration({
    RUBY_OPENAI_MODEL: "gpt-example",
    RUBY_INPUT_COST_PER_MILLION_USD: "0.15",
    RUBY_OUTPUT_COST_PER_MILLION_USD: "0.60",
    RUBY_MONTHLY_BUDGET_USD: "100.01",
  }), null);
  assert.equal(rubyCostConfiguration({
    RUBY_OPENAI_MODEL: "gpt-example",
    RUBY_INPUT_COST_PER_MILLION_USD: "",
    RUBY_OUTPUT_COST_PER_MILLION_USD: "0.60",
    RUBY_MONTHLY_BUDGET_USD: "25",
  }), null);
});

test("Ruby usage accepts only validated Responses token counts", () => {
  assert.deepEqual(rubyUsageFromResponse({ usage: { input_tokens: 120, output_tokens: 60 } }), {
    inputTokens: 120,
    outputTokens: 60,
  });
  assert.equal(rubyUsageFromResponse({ usage: { input_tokens: -1, output_tokens: 60 } }), null);
});

test("Ruby monthly usage reservations are service-only and concurrency-safe", () => {
  assert.match(usageMigration, /enable row level security/);
  assert.match(usageMigration, /pg_advisory_xact_lock/);
  assert.match(usageMigration, /p_monthly_limit_microusd not between 1 and 100000000/);
  assert.match(usageMigration, /status = 'settled'/);
  assert.match(usageMigration, /to service_role/);
  assert.doesNotMatch(usageMigration, /grant execute on function public\.reserve_ruby_ai_budget[^;]*authenticated/i);
});
