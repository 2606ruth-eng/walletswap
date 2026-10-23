import { serviceClient } from "../_shared/client.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import { validateBalanceWebhook, verifyWebhookSignature } from "../_shared/retailer-webhook.js";

const MAX_BODY_BYTES = 8192;

async function readBoundedBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return jsonResponse(request, 200, {});
  if (request.method !== "POST") return jsonResponse(request, 405, { error: "Method not allowed." });
  const rawBody = await readBoundedBody(request);
  if (rawBody === null) {
    return jsonResponse(request, 413, { error: "Webhook payload is too large." });
  }

  let event;
  try {
    event = validateBalanceWebhook(JSON.parse(rawBody));
  } catch {
    return jsonResponse(request, 400, { error: "Webhook payload is invalid." });
  }
  const secretName = event.test_event ? "WALLET_SWAP_TEST_WEBHOOK_SECRET" : "AUTHORIZED_BALANCE_WEBHOOK_SECRET";
  const secret = Deno.env.get(secretName);
  if (!secret) {
    return jsonResponse(request, 503, {
      error: event.test_event
        ? "Signed webhook test mode is not configured."
        : "No approved retailer verification integration is configured.",
    });
  }
  const signature = request.headers.get("x-walletswap-signature") || "";
  let valid = false;
  try {
    valid = await verifyWebhookSignature(secret, rawBody, signature);
  } catch {
    return jsonResponse(request, 503, { error: "Webhook signature verification is unavailable." });
  }
  if (!valid) return jsonResponse(request, 401, { error: "Webhook signature is invalid." });

  const admin = serviceClient();
  if (!admin) return jsonResponse(request, 503, { error: "Balance update storage is not configured." });
  const { data, error } = await admin.rpc("record_authorized_balance_update", {
    p_provider: event.provider,
    p_event_id: event.event_id,
    p_card_id: event.card_id,
    p_balance: event.balance,
    p_currency: event.currency,
    p_test_event: event.test_event === true,
  });
  if (error) {
    if (error.code === "42501") return jsonResponse(request, 403, { error: "The provider is not approved for this update." });
    if (error.code === "P0002") return jsonResponse(request, 404, { error: "The wallet card was not found." });
    if (error.code === "22023") return jsonResponse(request, 400, { error: "The balance update does not match the card." });
    return jsonResponse(request, 500, { error: "The balance update could not be recorded." });
  }
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  });
});
