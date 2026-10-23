import { authenticatedUser } from "../_shared/client.ts";
import { jsonResponse, rejectDisallowedOrigin, validUuid } from "../_shared/http.ts";

Deno.serve(async request => {
  if (request.method === "OPTIONS") return jsonResponse(request, 200, {});
  const originError = rejectDisallowedOrigin(request);
  if (originError) return originError;
  if (request.method !== "POST") return jsonResponse(request, 405, { error: "Method not allowed." });

  try {
    const context = await authenticatedUser(request);
    if (!context) return jsonResponse(request, 401, { error: "Authentication required." });
    const body = await request.json();
    if (!body || typeof body !== "object" || typeof body.action !== "string") {
      return jsonResponse(request, 400, { error: "A wallet action is required." });
    }

    if (body.action === "summary") {
      const { data, error } = await context.client.rpc("get_wallet_summary");
      if (error) return jsonResponse(request, 400, { error: "Wallet summary is unavailable." });
      return jsonResponse(request, 200, { summary: data });
    }
    if (body.action === "archive" && validUuid(body.cardId)) {
      const { error } = await context.client.rpc("archive_wallet_card", { p_card_id: body.cardId });
      if (error) return jsonResponse(request, 400, { error: "Card could not be archived." });
      return jsonResponse(request, 200, { archived: true });
    }
    if (body.action === "purchase" && validUuid(body.cardId)) {
      if (typeof body.amount !== "string" || !/^\d{1,10}(?:\.\d{1,2})?$/.test(body.amount)) {
        return jsonResponse(request, 400, { error: "Purchase amount is invalid." });
      }
      if (typeof body.idempotencyKey !== "string" || !/^[0-9a-f-]{36}$/i.test(body.idempotencyKey)) {
        return jsonResponse(request, 400, { error: "Idempotency key is invalid." });
      }
      const { data, error } = await context.client.rpc("record_card_purchase", {
        p_card_id: body.cardId,
        p_amount: body.amount,
        p_idempotency_key: body.idempotencyKey,
        p_description: "User-recorded purchase",
      });
      if (error) return jsonResponse(request, 400, { error: "Purchase could not be recorded." });
      return jsonResponse(request, 200, { card: data, balance_source: "user_reported" });
    }
    return jsonResponse(request, 400, { error: "Wallet action is not supported." });
  } catch {
    return jsonResponse(request, 400, { error: "Wallet action request is invalid." });
  }
});
