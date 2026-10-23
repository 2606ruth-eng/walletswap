import { authenticatedUser } from "../_shared/client.ts";
import { jsonResponse, rejectDisallowedOrigin, validUuid } from "../_shared/http.ts";

const ACTIONS: Record<string, { rpc: string; args: (body: Record<string, unknown>) => Record<string, unknown> }> = {
  create_listing: { rpc: "create_marketplace_listing", args: body => ({ p_card_id: body.cardId, p_asking_price: body.askingPrice ?? null }) },
  reprice_listing: { rpc: "reprice_marketplace_listing", args: body => ({ p_listing_id: body.listingId, p_asking_price: body.askingPrice }) },
  cancel_listing: { rpc: "cancel_marketplace_listing", args: body => ({ p_listing_id: body.listingId }) },
  create_swap: { rpc: "create_swap_proposal", args: body => ({ p_offered_card_id: body.offeredCardId, p_requested_listing_id: body.listingId }) },
  respond_swap: { rpc: "respond_to_swap_proposal", args: body => ({ p_request_id: body.requestId, p_response: body.response }) },
  prepare_simulated_purchase: { rpc: "prepare_simulated_purchase", args: body => ({ p_listing_id: body.listingId, p_idempotency_key: body.idempotencyKey }) },
};

function validateAction(action: string, body: Record<string, unknown>): boolean {
  if (action === "create_listing") return validUuid(body.cardId)
    && (body.askingPrice === undefined || body.askingPrice === null
      || (typeof body.askingPrice === "string" && /^\d{1,10}\.\d{2}$/.test(body.askingPrice)));
  if (action === "reprice_listing") return validUuid(body.listingId) && typeof body.askingPrice === "string" && /^\d{1,10}\.\d{2}$/.test(body.askingPrice);
  if (action === "cancel_listing") return validUuid(body.listingId);
  if (action === "create_swap") return validUuid(body.offeredCardId) && validUuid(body.listingId);
  if (action === "respond_swap") return validUuid(body.requestId) && ["accept", "reject", "cancel"].includes(String(body.response));
  if (action === "prepare_simulated_purchase") return validUuid(body.listingId) && typeof body.idempotencyKey === "string" && /^[0-9a-f-]{36}$/i.test(body.idempotencyKey);
  return false;
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return jsonResponse(request, 200, {});
  const originError = rejectDisallowedOrigin(request);
  if (originError) return originError;
  if (request.method !== "POST") return jsonResponse(request, 405, { error: "Method not allowed." });

  try {
    const context = await authenticatedUser(request);
    if (!context) return jsonResponse(request, 401, { error: "Authentication required." });
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    const definition = ACTIONS[action];
    if (!definition || !validateAction(action, body)) {
      return jsonResponse(request, 400, { error: "Marketplace action is invalid." });
    }
    const { data, error } = await context.client.rpc(definition.rpc, definition.args(body));
    if (error) return jsonResponse(request, 400, { error: "Marketplace action could not be completed." });
    return jsonResponse(request, 200, {
      result: data,
      financial_status: action === "prepare_simulated_purchase" ? "simulation_pending_no_payment_or_transfer" : undefined,
    });
  } catch {
    return jsonResponse(request, 400, { error: "Marketplace action request is invalid." });
  }
});
