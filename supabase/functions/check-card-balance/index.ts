import { authenticatedUser, serviceClient } from "../_shared/client.ts";
import { jsonResponse, rejectDisallowedOrigin, validUuid } from "../_shared/http.ts";
import { getCardBalanceProvider, safeProviderErrorCategory, validateNormalizedProviderResult } from "../_shared/card-balance-providers.js";

const MAX_BODY_BYTES = 2048;

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
  const originError = rejectDisallowedOrigin(request);
  if (originError) return originError;
  if (request.method !== "POST") return jsonResponse(request, 405, { error: "Method not allowed." });

  const context = await authenticatedUser(request);
  if (!context) return jsonResponse(request, 401, { error: "Authentication required." });

  const rawBody = await readBoundedBody(request);
  if (rawBody === null) return jsonResponse(request, 413, { error: "Verification request is too large." });
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse(request, 400, { error: "Verification request is invalid." });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse(request, 400, { error: "Verification request is invalid." });
  }
  if (
    Object.keys(body).some(key => !["card_id", "request_id", "consent"].includes(key))
    || !validUuid(body.card_id)
    || !validUuid(body.request_id)
    || body.consent !== true
  ) return jsonResponse(request, 400, { error: "Verification request fields or consent are invalid." });

  const { data: card, error: cardError } = await context.client.from("wallet_cards")
    .select("id,retailer,card_type,currency,original_value,archived_at")
    .eq("id", body.card_id).eq("owner_id", context.user.id).is("archived_at", null).maybeSingle();
  if (cardError) return jsonResponse(request, 500, { error: "Card ownership could not be verified." });
  if (!card) return jsonResponse(request, 404, { error: "Card not found." });

  const { data: retailer, error: retailerError } = await context.client.from("retailer_integrations")
    .select("retailer,verification_method,integration_status,supports_balance_verification,authorized_provider,supported_card_types,credentials_required")
    .eq("retailer", card.retailer).maybeSingle();
  if (retailerError) return jsonResponse(request, 500, { error: "Retailer configuration could not be checked." });
  if (
    !retailer
    || retailer.verification_method !== "AUTHORIZED_API"
    || !(
      retailer.integration_status === "approved"
      || (retailer.integration_status === "sandbox" && retailer.authorized_provider === "adyen")
    )
    || retailer.supports_balance_verification !== true
    || !retailer.authorized_provider
  ) return jsonResponse(request, 409, { error: "Automatic verification is unavailable for this retailer." });
  if (!Array.isArray(retailer.supported_card_types) || !retailer.supported_card_types.includes(card.card_type)) {
    return jsonResponse(request, 422, { error: "This card type is not supported by the approved provider." });
  }

  const provider = getCardBalanceProvider(retailer.authorized_provider);
  if (!provider || !provider.supportsCard({ retailer: card.retailer, cardType: card.card_type, currency: card.currency })) {
    return jsonResponse(request, 503, {
      error: "The approved provider adapter is not configured for this card.",
      category: safeProviderErrorCategory("provider_not_configured"),
    });
  }

  const admin = serviceClient();
  if (!admin) return jsonResponse(request, 503, { error: "Verification storage is not configured." });
  const { data: requestRecord, error: beginError } = await context.client.rpc("begin_card_balance_verification", {
    p_card_id: card.id,
    p_request_id: body.request_id,
    p_consent: body.consent,
  });
  if (beginError) {
    if (beginError.code === "23505") return jsonResponse(request, 409, { error: "This balance check was already requested." });
    if (beginError.code === "P0001") return jsonResponse(request, 429, { error: "Balance checks are temporarily limited. Try again later." });
    if (beginError.code === "42501") return jsonResponse(request, 403, { error: "The card is not eligible for this provider." });
    return jsonResponse(request, 500, { error: "The balance check could not be started." });
  }
  if (!requestRecord?.request_id) return jsonResponse(request, 409, { error: "This balance check was already requested." });

  try {
    const rawResult = await provider.checkBalance({ card, requestId: requestRecord.request_id });
    if ((rawResult.testData === true) !== (requestRecord.test_data === true)) {
      throw new Error("invalid_provider_response");
    }
    const result = validateNormalizedProviderResult(
      rawResult,
      card.currency,
      Math.round(Number(card.original_value) * 100),
    );
    const { error: completionError } = await admin.rpc("complete_card_balance_verification", {
      p_request_id: requestRecord.request_id,
      p_status: "PROVIDER_VERIFIED",
      p_balance_minor: result.balanceMinor,
      p_currency: result.currency,
      p_error_category: null,
      p_test_data: requestRecord.test_data === true,
    });
    if (completionError) throw new Error("unknown");
    return jsonResponse(request, 200, {
      status: "PROVIDER_VERIFIED",
      balance_minor: result.balanceMinor,
      currency: result.currency,
      provider_id: retailer.authorized_provider,
      test_data: requestRecord.test_data === true,
    });
  } catch (error) {
    const category = safeProviderErrorCategory(error instanceof Error ? error.message : "unknown");
    const { error: completionError } = await admin.rpc("complete_card_balance_verification", {
      p_request_id: requestRecord.request_id,
      p_status: "VERIFICATION_FAILED",
      p_balance_minor: null,
      p_currency: null,
      p_error_category: category,
      p_test_data: requestRecord.test_data === true,
    });
    if (completionError) return jsonResponse(request, 500, { error: "The safe verification result could not be recorded." });
    const status = category === "provider_timeout" ? 504 : 502;
    return jsonResponse(request, status, { status: "VERIFICATION_FAILED", category });
  }
});
