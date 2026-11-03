import { centsToDecimal, dollarsToCents } from "./wallet.js";
import { requireSupabase } from "./supabase.js";

function mapListing(row) {
  return {
    id: row.id,
    brand: row.retailer,
    brandName: "",
    value: Number(row.reported_balance),
    price: Number(row.asking_price),
    currency: row.currency,
    seller: "WalletSwap seller",
    rating: "n/a",
    type: row.card_type === "physical" ? "Physical" : "Digital",
    listedAt: new Date(row.created_at).getTime(),
    discount: Number(row.discount_percentage),
    fee: Number(row.fee_percentage),
    estimatedPayout: Number(row.estimated_seller_payout),
    status: row.status || "active",
  };
}

const BASE_COLUMNS = "id,retailer,card_type,currency,reported_balance,asking_price,discount_percentage,fee_percentage,estimated_seller_payout,created_at";
// balance_verification is added by a migration pending approval; fall back to the base view without it.
const PUBLIC_COLUMNS = `${BASE_COLUMNS},balance_verification`;

export async function getPublicListings({ search = "", retailer = "", limit = 50 } = {}) {
  const run = columns => {
    let query = requireSupabase().from("public_marketplace_listings")
      .select(columns).order("created_at", { ascending: false }).limit(Math.min(Math.max(limit, 1), 100));
    if (retailer) query = query.eq("retailer", retailer);
    if (search.trim()) query = query.ilike("retailer", `%${search.trim().replace(/[%_]/g, "")}%`);
    return query;
  };
  let { data, error } = await run(PUBLIC_COLUMNS);
  if (error && (error.code === "42703" || /balance_verification/.test(error.message || ""))) {
    ({ data, error } = await run(BASE_COLUMNS));
  }
  if (error) throw error;
  return (data || []).map(mapListing);
}

export async function searchListings(search, options = {}) {
  return getPublicListings({ ...options, search });
}

export async function getMyListings() {
  const { data, error } = await requireSupabase().from("marketplace_listings")
    .select("id,card_id,currency,asking_price,discount_percentage,fee_percentage,estimated_seller_payout,status,created_at")
    .in("status", ["draft", "active", "reserved"]).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createListing(cardId, askingPrice) {
  const { data, error } = await requireSupabase().rpc("create_marketplace_listing", {
    p_card_id: cardId,
    p_asking_price: centsToDecimal(dollarsToCents(askingPrice)),
  });
  if (error) throw error;
  return data;
}

export async function updateListing(listingId, askingPrice) {
  const cents = dollarsToCents(askingPrice);
  const { data, error } = await requireSupabase().rpc("reprice_marketplace_listing", {
    p_listing_id: listingId,
    p_asking_price: centsToDecimal(cents),
  });
  if (error) throw error;
  return data;
}

export async function cancelListing(listingId) {
  const { data, error } = await requireSupabase().rpc("cancel_marketplace_listing", { p_listing_id: listingId });
  if (error) throw error;
  return data;
}

export async function prepareSimulatedPurchase(listingId, idempotencyKey = crypto.randomUUID()) {
  const { data, error } = await requireSupabase().rpc("prepare_simulated_purchase", {
    p_listing_id: listingId,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  return data;
}

export async function createSwapProposal(offeredCardId, requestedListingId) {
  const { data, error } = await requireSupabase().rpc("create_swap_proposal", {
    p_offered_card_id: offeredCardId,
    p_requested_listing_id: requestedListingId,
  });
  if (error) throw error;
  return data;
}

export async function respondToSwapProposal(requestId, response) {
  const { data, error } = await requireSupabase().rpc("respond_to_swap_proposal", {
    p_request_id: requestId,
    p_response: response,
  });
  if (error) throw error;
  return data;
}

export const DEFAULT_FEE_PERCENT = 5;

// The configured fee lives in marketplace_settings (migration pending approval).
// Until that exists the existing 5% platform fee, which the backend applies, is shown.
export async function getMarketplaceFeePercent() {
  try {
    const { data, error } = await requireSupabase().from("marketplace_settings").select("fee_percentage").maybeSingle();
    if (error || !data) return DEFAULT_FEE_PERCENT;
    const value = Number(data.fee_percentage);
    return Number.isFinite(value) && value >= 0 && value <= 50 ? value : DEFAULT_FEE_PERCENT;
  } catch {
    return DEFAULT_FEE_PERCENT;
  }
}
