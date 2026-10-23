import { authenticatedUser, serviceClient } from "../_shared/client.ts";
import { jsonResponse, rejectDisallowedOrigin, validUuid } from "../_shared/http.ts";
import { conversationInput, responseFunctionCalls, responseText as extractResponseText, toResponsesTools } from "../_shared/ruby-responses.js";
import { estimateRubyCostMicros, formatRubyCostMicros, rubyCostConfiguration, rubyUsageFromResponse } from "../_shared/ruby-usage.js";

const MAX_MESSAGE = 4000;
const MAX_REQUEST_BYTES = 16_000;
const MAX_HISTORY_CHARS = 8000;
const MAX_TOOL_CALLS = 4;
const MAX_MODEL_ROUNDS = 4;
const MAX_OUTPUT_TOKENS = 600;
const MAX_RESERVED_INPUT_TOKENS = 512_000;
const REQUESTS_PER_MINUTE = 5;
const SENSITIVE_VALUE = /(?:\b(?:\d[ -]?){8,19}\b)|(?:\b(?:pin|cvc|cvv|security code|redemption code)\s*[:=]?\s*\d{3,}\b)/i;
const OPTIONAL_TOOL_ARGUMENTS = new Set(["get_card_activity.card_id", "get_expiring_cards.days", "search_marketplace_listings.retailer"]);

const TOOL_DEFINITIONS = [
  ["get_wallet_summary", "Summarize this authenticated user's balances by currency and verification status.", {}],
  ["get_wallet_cards", "List safe metadata for this authenticated user's active gift cards. Include reported balance and verification status; never return credentials.", {}],
  ["get_card_details", "Read safe metadata for one card owned by this user. Never return full identifiers.", {
    card_id: { type: "string" },
  }],
  ["get_card_activity", "Read recent activity recorded in WalletSwap for this user.", {
    card_id: { type: "string" },
  }],
  ["get_expiring_cards", "List this user's cards with a printed expiry within 90 days.", {
    days: { type: "integer" },
  }],
  ["get_unused_cards", "List cards with no recent WalletSwap purchase record; this does not detect external use.", {}],
  ["get_recent_balance_changes", "List recent WalletSwap-recorded balance changes with verification labels.", {}],
  ["get_notification_preferences", "Read this user's notification settings.", {}],
  ["get_recent_notifications", "List recent in-app notifications for this authenticated user.", {}],
  ["generate_weekly_wallet_summary", "Summarize this user's balances and WalletSwap-recorded activity from the last seven days. State that activity outside WalletSwap is unavailable.", {}],
  ["search_marketplace_listings", "Search public marketplace listing metadata.", {
    retailer: { type: "string" },
  }],
  ["estimate_listing_price", "Estimate the beta asking price (90% of the user's reported balance) and 5% platform fee.", {
    card_id: { type: "string" },
  }],
  ["find_swap_matches", "Find public listing amounts close to one owned card's reported balance.", {
    card_id: { type: "string" },
  }],
  ["prepare_listing", "Explain the listing to prepare and require the user to confirm in the WalletSwap UI; do not create it.", {
    card_id: { type: "string" },
  }],
  ["prepare_swap_request", "Explain a proposed swap and require the user to confirm in the WalletSwap UI; do not create it.", {
    offered_card_id: { type: "string" },
    listing_id: { type: "string" },
  }],
  ["get_wallet_pass_eligibility", "Check whether an approved wallet pass issuer is configured for an owned card.", {
    card_id: { type: "string" },
    platform: { type: "string", enum: ["apple", "google"] },
  }],
].map(([name, description, properties]) => ({
  type: "function",
  function: {
    name,
    description,
    parameters: {
      type: "object",
      properties,
      required: Object.keys(properties).filter(key => !OPTIONAL_TOOL_ARGUMENTS.has(`${name}.${key}`)),
      additionalProperties: false,
    },
  },
}));

function integerCents(value: unknown): bigint {
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return 0n;
  return BigInt(match[1]) * 100n + BigInt(((match[2] || "") + "00").slice(0, 2));
}

function formatCents(value: bigint): string {
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

async function runTool(client: NonNullable<Awaited<ReturnType<typeof authenticatedUser>>>["client"], name: string, args: Record<string, unknown>) {
  if (name === "get_wallet_summary") {
    const { data, error } = await client.rpc("get_wallet_summary");
    if (error) throw error;
    return data;
  }
  if (name === "get_wallet_cards") {
    const { data, error, count } = await client.from("wallet_cards")
      .select("id,retailer,nickname,card_type,currency,original_value,reported_balance,expiration_date,masked_identifier,verification_status,verification_source,verified_at", { count: "exact" })
      .is("archived_at", null).order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    return { cards: data, total_count: count };
  }
  if (name === "get_card_details" || name === "estimate_listing_price" || name === "prepare_listing") {
    if (!validUuid(args.card_id)) throw new Error("Invalid card id");
    const { data, error } = await client.from("wallet_cards")
      .select("id,retailer,nickname,card_type,currency,original_value,reported_balance,expiration_date,masked_identifier,verification_status,verification_source,verified_at")
      .eq("id", args.card_id).is("archived_at", null).maybeSingle();
    if (error || !data) {
      if (error) throw error;
      return { error: "Card not found." };
    }
    if (name === "get_card_details") {
      const { owner_id: _owner, ...safe } = data;
      return safe;
    }
    const balance = integerCents(data.reported_balance);
    const asking = (balance * 90n + 50n) / 100n;
    const fee = (asking * 5n + 50n) / 100n;
    if (name === "prepare_listing") {
      return { retailer: data.retailer, reported_balance: formatCents(balance), estimated_asking_price: formatCents(asking), estimated_fee: formatCents(fee), requires_ui_confirmation: true, created: false };
    }
    return { retailer: data.retailer, currency: data.currency, reported_balance: formatCents(balance), asking_price: formatCents(asking), fee: formatCents(fee), estimated_seller_payout: formatCents(asking - fee), balance_status: data.verification_status };
  }
  if (name === "get_card_activity") {
    if (args.card_id !== undefined && !validUuid(args.card_id)) throw new Error("Invalid card id");
    let query = client.from("card_activity")
      .select("card_id,activity_type,amount,previous_balance,new_balance,data_source,verification_status,requires_review,created_at")
      .order("created_at", { ascending: false }).limit(30);
    if (args.card_id) query = query.eq("card_id", args.card_id);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }
  if (name === "get_expiring_cards") {
    const days = Number(args.days ?? 30);
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error("Invalid expiry window");
    const today = new Date().toISOString().slice(0, 10);
    const until = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const { data, error } = await client.from("wallet_cards")
      .select("retailer,nickname,expiration_date,verification_status")
      .gte("expiration_date", today).lte("expiration_date", until).is("archived_at", null)
      .order("expiration_date").limit(50);
    if (error) throw error;
    return data;
  }
  if (name === "get_unused_cards") {
    const { data: cards, error } = await client.from("wallet_cards")
      .select("id,retailer,nickname,reported_balance,currency,verification_status")
      .is("archived_at", null).gt("reported_balance", 0).limit(100);
    if (error) throw error;
    const ids = (cards || []).map(card => card.id);
    if (!ids.length) return { cards: [], limitation: "WalletSwap cannot observe redemptions outside this app." };
    const { data: activity, error: activityError } = await client.from("card_activity")
      .select("card_id").in("card_id", ids).eq("activity_type", "purchase")
      .gte("created_at", new Date(Date.now() - 90 * 86400000).toISOString());
    if (activityError) throw activityError;
    const used = new Set((activity || []).map(item => item.card_id));
    return { cards: cards.filter(card => !used.has(card.id)), limitation: "No recent WalletSwap purchase is recorded; external use is unknown." };
  }
  if (name === "get_recent_balance_changes") {
    const { data, error } = await client.from("card_activity")
      .select("card_id,activity_type,amount,previous_balance,new_balance,data_source,verification_status,requires_review,created_at")
      .in("activity_type", ["purchase", "balance_adjustment"])
      .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString())
      .order("created_at", { ascending: false }).limit(30);
    if (error) throw error;
    return data;
  }
  if (name === "get_notification_preferences") {
    const { data, error } = await client.from("notification_preferences")
      .select("card_activity_enabled,balance_change_enabled,expiry_reminders_enabled,weekly_summary_enabled,marketplace_alerts_enabled")
      .maybeSingle();
    if (error) throw error;
    return data || {
      card_activity_enabled: true,
      balance_change_enabled: true,
      expiry_reminders_enabled: true,
      weekly_summary_enabled: false,
      marketplace_alerts_enabled: true,
    };
  }
  if (name === "get_recent_notifications") {
    const { data, error } = await client.from("notifications")
      .select("notification_type,title,message,created_at,read_at")
      .order("created_at", { ascending: false }).limit(20);
    if (error) throw error;
    return data;
  }
  if (name === "generate_weekly_wallet_summary") {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const [{ data: cards, error: cardsError }, { data: activity, error: activityError }] = await Promise.all([
      client.from("wallet_cards").select("retailer,currency,reported_balance,verification_status")
        .is("archived_at", null).limit(100),
      client.from("card_activity").select("activity_type,amount,data_source,verification_status,created_at")
        .gte("created_at", since).order("created_at", { ascending: false }).limit(100),
    ]);
    if (cardsError) throw cardsError;
    if (activityError) throw activityError;
    const balances = new Map<string, { card_count: number; reported_balance_cents: bigint; verified_balance_cents: bigint }>();
    for (const card of cards || []) {
      const group = balances.get(card.currency) || {
        card_count: 0,
        reported_balance_cents: 0n,
        verified_balance_cents: 0n,
      };
      const cents = integerCents(card.reported_balance);
      group.card_count += 1;
      group.reported_balance_cents += cents;
      if (card.verification_status === "verified") group.verified_balance_cents += cents;
      balances.set(card.currency, group);
    }
    return {
      period_days: 7,
      balances: Array.from(balances, ([currency, group]) => ({
        currency,
        card_count: group.card_count,
        reported_balance: formatCents(group.reported_balance_cents),
        verified_balance: formatCents(group.verified_balance_cents),
      })),
      activity: (activity || []).map(item => ({
        activity_type: item.activity_type,
        amount: item.amount,
        data_source: item.data_source,
        verification_status: item.verification_status,
        created_at: item.created_at,
      })),
      limitation: "Only activity recorded in WalletSwap is included; there is no connected external transaction feed.",
    };
  }
  if (name === "search_marketplace_listings") {
    let query = client.from("public_marketplace_listings")
      .select("retailer,card_type,currency,reported_balance,asking_price,discount_percentage,fee_percentage,estimated_seller_payout,created_at")
      .eq("retailer", String(args.retailer || "").slice(0, 40)).order("created_at", { ascending: false }).limit(20);
    if (!args.retailer) query = client.from("public_marketplace_listings")
      .select("retailer,card_type,currency,reported_balance,asking_price,discount_percentage,fee_percentage,estimated_seller_payout,created_at")
      .order("created_at", { ascending: false }).limit(20);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }
  if (name === "find_swap_matches") {
    if (!validUuid(args.card_id)) throw new Error("Invalid card id");
    const { data: card, error: cardError } = await client.from("wallet_cards")
      .select("reported_balance,currency").eq("id", args.card_id).is("archived_at", null).maybeSingle();
    if (cardError) throw cardError;
    if (!card) return { error: "Card not found." };
    const { data, error } = await client.from("public_marketplace_listings")
      .select("id,retailer,card_type,currency,reported_balance,asking_price")
      .eq("currency", card.currency).limit(50);
    if (error) throw error;
    const target = integerCents(card.reported_balance);
    return (data || []).map(item => {
      const value = integerCents(item.reported_balance);
      const difference = value > target ? value - target : target - value;
      return { ...item, difference: formatCents(difference), differenceCents: difference };
    }).sort((a, b) => a.differenceCents < b.differenceCents ? -1 : a.differenceCents > b.differenceCents ? 1 : 0)
      .map(({ differenceCents: _differenceCents, ...item }) => item).slice(0, 10);
  }
  if (name === "prepare_swap_request") {
    if (!validUuid(args.offered_card_id) || !validUuid(args.listing_id)) throw new Error("Invalid swap ids");
    const { data: card, error } = await client.from("wallet_cards")
      .select("id,retailer,reported_balance,currency").eq("id", args.offered_card_id).is("archived_at", null).maybeSingle();
    if (error) throw error;
    if (!card) return { error: "Offered card not found." };
    const { data: listing, error: listingError } = await client.from("public_marketplace_listings")
      .select("id,retailer,reported_balance,currency,asking_price").eq("id", args.listing_id).maybeSingle();
    if (listingError) throw listingError;
    if (!listing) return { error: "Requested listing not found." };
    return { offered_card: { retailer: card.retailer, reported_balance: card.reported_balance, currency: card.currency }, requested_listing: listing, requires_ui_confirmation: true, created: false };
  }
  if (name === "get_wallet_pass_eligibility") {
    if (!validUuid(args.card_id) || !["apple", "google"].includes(String(args.platform))) throw new Error("Invalid pass request");
    const { data, error } = await client.rpc("get_wallet_pass_eligibility", {
      p_card_id: args.card_id,
      p_platform: args.platform,
    });
    if (error) throw error;
    return data;
  }
  throw new Error("Tool is not available");
}

function normalizeToolArgs(name: string, raw: string): Record<string, unknown> {
  if (raw.length > 4000) throw new Error("Tool arguments are too large");
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tool arguments are invalid");
  const definition = TOOL_DEFINITIONS.find(tool => tool.function.name === name);
  if (!definition) throw new Error("Tool is not available");
  const allowed = Object.keys(definition.function.parameters.properties);
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Tool arguments contain an unsupported field");
  for (const optional of OPTIONAL_TOOL_ARGUMENTS) {
    const [toolName, key] = optional.split(".");
    if (toolName === name && value[key] === null) delete value[key];
  }
  if (["card_id", "offered_card_id", "listing_id"].some(key => value[key] !== undefined && !validUuid(value[key]))) {
    throw new Error("Tool identifier is invalid");
  }
  if (value.days !== undefined && (!Number.isInteger(value.days) || Number(value.days) < 1 || Number(value.days) > 90)) {
    throw new Error("Tool day range is invalid");
  }
  if (value.platform !== undefined && !["apple", "google"].includes(String(value.platform))) {
    throw new Error("Tool platform is invalid");
  }
  if (value.retailer !== undefined && (typeof value.retailer !== "string" || value.retailer.length > 40)) {
    throw new Error("Tool retailer is invalid");
  }
  return value;
}

async function persistConversation(
  client: NonNullable<Awaited<ReturnType<typeof authenticatedUser>>>["client"],
  admin: NonNullable<ReturnType<typeof serviceClient>>,
  userId: string,
  conversationId: string,
  message: string,
  reply: string,
) {
  const { error: userMessageError } = await client.from("ruby_messages").insert({
    conversation_id: conversationId,
    user_id: userId,
    role: "user",
    content: message,
  });
  if (userMessageError) throw userMessageError;
  const { error: assistantMessageError } = await admin.from("ruby_messages").insert({
    conversation_id: conversationId,
    user_id: userId,
    role: "assistant",
    content: reply,
  });
  if (assistantMessageError) throw assistantMessageError;
  const { error: conversationUpdateError } = await client.from("ruby_conversations")
    .update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
  if (conversationUpdateError) throw conversationUpdateError;
}

async function recordToolEvents(admin: NonNullable<ReturnType<typeof serviceClient>>, userId: string, conversationId: string | null, events: Array<{ name: string; status: string }>) {
  if (!events.length) return;
  const rows = events.map(event => ({
    user_id: userId,
    conversation_id: conversationId,
    tool_name: event.name.slice(0, 80),
    execution_status: event.status,
  }));
  const { error } = await admin.from("ruby_tool_events").insert(rows);
  if (error) console.error("Ruby tool metadata could not be recorded.");
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return jsonResponse(request, 200, {});
  const originError = rejectDisallowedOrigin(request);
  if (originError) return originError;
  if (request.method !== "POST") return jsonResponse(request, 405, { error: "Method not allowed." });
  try {
    const context = await authenticatedUser(request);
    if (!context) return jsonResponse(request, 401, { error: "Authentication required." });
    const { client, user } = context;
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return jsonResponse(request, 413, { error: "Ruby request is too large." });
    }
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return jsonResponse(request, 413, { error: "Ruby request is too large." });
    }
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return jsonResponse(request, 400, { error: "Ruby request is invalid." });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return jsonResponse(request, 400, { error: "Ruby request is invalid." });
    }
    if (Object.keys(body).some(key => !["message", "conversationId"].includes(key))) {
      return jsonResponse(request, 400, { error: "Ruby request contains an unsupported field." });
    }
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const conversationId = body?.conversationId === null || body?.conversationId === undefined ? null : body.conversationId;
    if (!message || message.length > MAX_MESSAGE) {
      return jsonResponse(request, 400, { error: "Ruby message is invalid." });
    }
    if (SENSITIVE_VALUE.test(message)) {
      return jsonResponse(request, 400, { error: "Remove card numbers, PINs, and redemption codes before asking Ruby." });
    }
    if (conversationId !== null && !validUuid(conversationId)) {
      return jsonResponse(request, 400, { error: "Conversation reference is invalid." });
    }
    const { data: withinLimit, error: limitError } = await client.rpc("consume_ruby_rate_limit", { p_max_requests: REQUESTS_PER_MINUTE });
    if (limitError || !withinLimit) return jsonResponse(request, 429, { error: "Ruby is busy. Please try again in a minute." });

    if (Deno.env.get("RUBY_AI_MODE") !== "live") {
      return jsonResponse(request, 503, { error: "Ruby Live AI is not enabled on the server." });
    }
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return jsonResponse(request, 503, { error: "Ruby AI credentials are not configured." });
    const costConfig = rubyCostConfiguration({
      RUBY_OPENAI_MODEL: Deno.env.get("RUBY_OPENAI_MODEL") || "",
      RUBY_INPUT_COST_PER_MILLION_USD: Deno.env.get("RUBY_INPUT_COST_PER_MILLION_USD") || "",
      RUBY_OUTPUT_COST_PER_MILLION_USD: Deno.env.get("RUBY_OUTPUT_COST_PER_MILLION_USD") || "",
      RUBY_MONTHLY_BUDGET_USD: Deno.env.get("RUBY_MONTHLY_BUDGET_USD") || "",
    });
    if (!costConfig) {
      return jsonResponse(request, 503, { error: "Ruby's model and monthly cost controls are not configured." });
    }
    const admin = serviceClient();
    if (!admin) return jsonResponse(request, 503, { error: "Ruby conversation storage is not configured." });
    let activeConversationId = conversationId as string | null;
    let history: Array<{ role: "user" | "assistant"; content: string }> = [];
    if (activeConversationId) {
      const { data: conversation, error: conversationError } = await client.from("ruby_conversations")
        .select("id").eq("id", activeConversationId).maybeSingle();
      if (conversationError || !conversation) {
        return jsonResponse(request, 404, { error: "Conversation was not found." });
      }
      const { data: messages, error: messagesError } = await client.from("ruby_messages")
        .select("role,content").eq("conversation_id", activeConversationId)
        .order("created_at", { ascending: false }).limit(12);
      if (messagesError) throw messagesError;
      const chronological = (messages || []).reverse() as typeof history;
      let historyChars = 0;
      history = [];
      for (let index = chronological.length - 1; index >= 0; index -= 1) {
        const item = chronological[index];
        if (historyChars + item.content.length > MAX_HISTORY_CHARS) break;
        historyChars += item.content.length;
        history.unshift(item);
      }
      if (history.some(item => SENSITIVE_VALUE.test(item.content))) {
        return jsonResponse(request, 400, { error: "This conversation contains sensitive card details and cannot be sent to Ruby." });
      }
    } else {
      const { data: conversation, error: conversationError } = await client.from("ruby_conversations")
        .insert({ user_id: user.id, title: message.slice(0, 120) })
        .select("id").single();
      if (conversationError || !conversation) throw conversationError || new Error("Conversation could not be created");
      activeConversationId = conversation.id;
    }

    const usageRequestId = crypto.randomUUID();
    const reservedCostMicros = estimateRubyCostMicros(
      MAX_RESERVED_INPUT_TOKENS,
      MAX_OUTPUT_TOKENS * MAX_MODEL_ROUNDS,
      costConfig,
    );
    const { data: budgetReserved, error: reserveError } = await admin.rpc("reserve_ruby_ai_budget", {
      p_request_id: usageRequestId,
      p_user_id: user.id,
      p_model: costConfig.model,
      p_estimated_cost_microusd: Number(reservedCostMicros),
      p_monthly_limit_microusd: Number(costConfig.monthlyLimit),
    });
    if (reserveError) {
      console.error("Ruby monthly budget reservation failed.");
      return jsonResponse(request, 503, { error: "Ruby's monthly usage controls are unavailable." });
    }
    if (!budgetReserved) {
      return jsonResponse(request, 429, { error: "Ruby's monthly usage limit has been reached." });
    }
    const input = conversationInput(history, message);
    const toolEvents: Array<{ name: string; status: string }> = [];
    let responseText = "";
    let providerStatus: number | null = null;
    let providerRequestCount = 0;
    let providerResponseCount = 0;
    let providerUsageComplete = true;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    try {
    for (let round = 0; round < MAX_MODEL_ROUNDS; round += 1) {
      providerRequestCount += 1;
      const completion = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: costConfig.model,
          store: false,
          instructions: "You are Ruby, WalletSwap's gift-card assistant. Use only authenticated tools for claims about this user's WalletSwap data. Distinguish user-reported from retailer-verified balances and user-reported activity from authorized retailer events. WalletSwap has no configured retailer transaction feed unless an approved provider integration is returned by tools; never claim to observe external transactions when none is connected. Never claim that you verified a balance or imply a user-reported balance is verified. Do not request or reveal full card identifiers, PINs, or redemption codes. Explain decreases neutrally and never assert fraud. If the user supplies an amount for a hypothetical sale estimate, clearly label the result illustrative; assume an asking price of 90% of that amount, a platform fee of 5% of asking price, and a payout equal to price minus fee. Treat listing and swap tools as previews only; state-changing actions require explicit confirmation in the WalletSwap UI. No real payments or card transfers are available.",
          input,
          tools: toResponsesTools(TOOL_DEFINITIONS),
          tool_choice: "auto",
          parallel_tool_calls: false,
          max_output_tokens: MAX_OUTPUT_TOKENS,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!completion.ok) {
        providerStatus = completion.status;
        console.error("Ruby AI provider returned an error.");
        break;
      }
      const payload = await completion.json();
      providerResponseCount += 1;
      const usage = rubyUsageFromResponse(payload);
      if (usage) {
        totalInputTokens += usage.inputTokens;
        totalOutputTokens += usage.outputTokens;
      } else {
        providerUsageComplete = false;
      }
      if (!Array.isArray(payload?.output)) throw new Error("Ruby response was empty");
      const calls = responseFunctionCalls(payload);
      if (!calls.length) {
        responseText = extractResponseText(payload).trim().slice(0, MAX_MESSAGE);
        break;
      }
      if (round === MAX_MODEL_ROUNDS - 1 || toolEvents.length + calls.length > MAX_TOOL_CALLS) {
        throw new Error("Ruby tool-call limit was reached");
      }
      input.push(...payload.output);
      for (const call of calls) {
        const name = call.name;
        if (!call.callId) throw new Error("Ruby tool call identifier was missing");
        try {
          const args = normalizeToolArgs(name, call.arguments || "{}");
          const result = await runTool(client, name, args);
          toolEvents.push({ name, status: "succeeded" });
          input.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify(result).slice(0, 6000) });
        } catch {
          toolEvents.push({ name: name || "unknown", status: "rejected" });
          input.push({
            type: "function_call_output",
            call_id: call.callId,
            output: JSON.stringify({ error: "This data request could not be completed." }),
          });
        }
      }
    }
    } catch {
      console.error("Ruby AI provider could not complete the request.");
    }
    await recordToolEvents(admin, user.id, activeConversationId, toolEvents);
    const responseIsSafe = Boolean(responseText) && !SENSITIVE_VALUE.test(responseText);
    const providerOutcomeUncertain = providerStatus === null && providerRequestCount > providerResponseCount;
    const hasActualUsage = providerResponseCount > 0 && providerUsageComplete && !providerOutcomeUncertain;
    const actualCostMicros = hasActualUsage
      ? estimateRubyCostMicros(totalInputTokens, totalOutputTokens, costConfig)
      : providerOutcomeUncertain || (providerResponseCount > 0 && !providerUsageComplete)
        ? reservedCostMicros
        : 0n;
    const settledInputTokens = hasActualUsage
      ? totalInputTokens
      : providerOutcomeUncertain || (providerResponseCount > 0 && !providerUsageComplete)
        ? MAX_RESERVED_INPUT_TOKENS
        : 0;
    const settledOutputTokens = hasActualUsage
      ? totalOutputTokens
      : providerOutcomeUncertain || (providerResponseCount > 0 && !providerUsageComplete)
        ? MAX_OUTPUT_TOKENS * MAX_MODEL_ROUNDS
        : 0;
    const { error: settleError } = await admin.rpc("settle_ruby_ai_budget", {
      p_request_id: usageRequestId,
      p_input_tokens: settledInputTokens,
      p_output_tokens: settledOutputTokens,
      p_actual_cost_microusd: Number(actualCostMicros),
    });
    if (settleError) console.error("Ruby AI usage reservation remains at its conservative estimate.");
    if (providerStatus !== null) {
      return jsonResponse(request, 503, { error: "Ruby's AI provider is temporarily unavailable. Please try again later." });
    }
    if (!responseText || !responseIsSafe) {
      return jsonResponse(request, 502, { error: "Ruby could not produce a safe response. Please try again." });
    }
    if (!activeConversationId) throw new Error("Conversation could not be established");
    await persistConversation(client, admin, user.id, activeConversationId, message, responseText);
    return jsonResponse(request, 200, {
      reply: responseText,
      conversationId: activeConversationId,
      mode: "live_ai",
      usage: {
        inputTokens: settledInputTokens,
        outputTokens: settledOutputTokens,
        estimatedCostMicrousd: formatRubyCostMicros(actualCostMicros),
        isEstimated: !hasActualUsage,
      },
    });
  } catch {
    console.error("Ruby request failed.");
    return jsonResponse(request, 500, { error: "Ruby is temporarily unavailable. Please try again later." });
  }
});
