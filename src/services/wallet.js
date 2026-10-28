import { requireSupabase } from "./supabase.js";

const CARD_COLUMNS = "id,owner_id,retailer,nickname,card_type,currency,original_value,reported_balance,expiration_date,masked_identifier,verification_status,verification_source,verified_at,last_activity_at,archived_at,created_at,updated_at";

export function dollarsToCents(value) {
  const raw = String(value ?? "").trim();
  const match = /^\$?((?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?)$/.exec(raw);
  if (!match) throw new Error("Enter a valid amount with up to two decimal places.");
  const digits = match[1].replace(/,/g, "");
  const [whole, fraction = ""] = digits.split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) throw new Error("Amount is outside the supported range.");
  return cents;
}

export function centsToDecimal(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("Amount in cents is invalid.");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function mapWalletCard(row) {
  const isCustomRetailer = String(row.retailer || "").startsWith("custom-");
  return {
    id: row.id,
    brand: row.retailer,
    brandName: row.retailer === "other" || isCustomRetailer ? row.nickname : "",
    nickname: row.retailer === "other" || isCustomRetailer ? "" : row.nickname,
    number: "",
    pin: "",
    last4: String(row.masked_identifier || "").slice(-4),
    original: Number(row.original_value),
    balance: Number(row.reported_balance),
    currency: row.currency,
    type: row.card_type === "physical" ? "Physical" : "Digital",
    expires: row.expiration_date || "",
    balanceVerification: row.verification_status === "verified" ? "verified" : "user-reported",
    verificationStatus: row.verification_status,
    verificationSource: row.verification_source,
    verifiedAt: row.verified_at,
    addedAt: new Date(row.created_at).getTime(),
    lastActivityAt: row.last_activity_at,
    status: row.archived_at ? "archived" : "active",
    listing: null,
    source: "supabase",
    paid: null,
  };
}

export function walletCardInsertPayload(card, ownerId) {
  const usesRetailerLabel = card.brand === "other" || String(card.brand || "").startsWith("custom-");
  return {
    owner_id: ownerId,
    retailer: String(card.brand || "").trim().toLowerCase(),
    nickname: String(usesRetailerLabel ? card.brandName : card.nickname || "").trim().slice(0, 80),
    card_type: String(card.type || "").toLowerCase(),
    currency: String(card.currency || "USD").toUpperCase(),
    original_value: centsToDecimal(dollarsToCents(card.original)),
    reported_balance: centsToDecimal(dollarsToCents(card.balance)),
    expiration_date: card.expires || null,
    masked_identifier: String(card.last4 || "").replace(/\D/g, "").slice(-4),
  };
}

export async function getWalletCards() {
  const client = requireSupabase();
  const [{ data: cards, error }, { data: listings, error: listingError }] = await Promise.all([
    client.from("wallet_cards").select(CARD_COLUMNS).is("archived_at", null).order("last_activity_at", { ascending: false }),
    client.from("marketplace_listings").select("id,card_id,asking_price,created_at,status").in("status", ["active", "reserved"]),
  ]);
  if (error) throw error;
  if (listingError) throw listingError;
  const byCard = new Map((listings || []).map(row => [row.card_id, row]));
  return (cards || []).map(row => {
    const card = mapWalletCard(row);
    const listing = byCard.get(row.id);
    if (listing) {
      card.status = "listed";
      card.listing = { id: listing.id, price: Number(listing.asking_price), listedAt: new Date(listing.created_at).getTime(), status: listing.status };
    }
    return card;
  });
}

export async function getWalletCardById(id) {
  const { data, error } = await requireSupabase()
    .from("wallet_cards").select(CARD_COLUMNS).eq("id", id).is("archived_at", null).maybeSingle();
  if (error) throw error;
  return data ? mapWalletCard(data) : null;
}

export async function addWalletCard(card) {
  const client = requireSupabase();
  const originalCents = dollarsToCents(card.original);
  const balanceCents = dollarsToCents(card.balance);
  if (originalCents < 1 || originalCents > 200000 || balanceCents > originalCents) {
    throw new Error("Card values are outside the supported range.");
  }
  const retailer = String(card.brand || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(retailer)) throw new Error("Select a supported retailer label.");
  const currency = String(card.currency || "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be a 3-letter code.");
  const cardType = String(card.type || "").toLowerCase();
  if (!["physical", "digital"].includes(cardType)) throw new Error("Select physical or digital.");

  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!authData.user) throw new Error("Sign in before adding a wallet card.");
  const { data, error } = await client.from("wallet_cards")
    .insert(walletCardInsertPayload({ ...card, currency, type: cardType, original: centsToDecimal(originalCents), balance: centsToDecimal(balanceCents) }, authData.user.id))
    .select(CARD_COLUMNS).single();
  if (error) throw error;
  return mapWalletCard(data);
}

export async function updateWalletCard(id, fields) {
  const allowed = {};
  if (fields.nickname !== undefined) allowed.nickname = String(fields.nickname).trim().slice(0, 80);
  if (fields.type !== undefined) {
    const type = String(fields.type).toLowerCase();
    if (!["physical", "digital"].includes(type)) throw new Error("Card type is invalid.");
    allowed.card_type = type;
  }
  if (fields.expires !== undefined) allowed.expiration_date = fields.expires || null;
  if (!Object.keys(allowed).length) throw new Error("No editable card details were provided.");
  const { data, error } = await requireSupabase().from("wallet_cards")
    .update(allowed).eq("id", id).select(CARD_COLUMNS).single();
  if (error) throw error;
  return mapWalletCard(data);
}

export async function archiveWalletCard(id) {
  const { error } = await requireSupabase().rpc("archive_wallet_card", { p_card_id: id });
  if (error) throw error;
}

export async function adjustReportedBalance(id, balance, idempotencyKey = crypto.randomUUID()) {
  const cents = dollarsToCents(balance);
  const { data, error } = await requireSupabase().rpc("adjust_reported_balance", {
    p_card_id: id,
    p_balance: centsToDecimal(cents),
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  return mapWalletCard(data);
}

export async function recordCardPurchase(id, amount, idempotencyKey = crypto.randomUUID(), description = "") {
  const cents = dollarsToCents(amount);
  const { data, error } = await requireSupabase().rpc("record_card_purchase", {
    p_card_id: id,
    p_amount: centsToDecimal(cents),
    p_idempotency_key: idempotencyKey,
    p_description: String(description).slice(0, 120),
  });
  if (error) throw error;
  return mapWalletCard(data);
}

export async function getWalletSummary() {
  const { data, error } = await requireSupabase().rpc("get_wallet_summary");
  if (error) throw error;
  return data || [];
}

export async function getCardActivity(cardId) {
  let query = requireSupabase().from("card_activity")
    .select("id,card_id,activity_type,amount,previous_balance,new_balance,data_source,verification_status,notification_status,requires_review,problem_reported_at,created_at")
    .order("created_at", { ascending: false }).limit(300);
  if (cardId) query = query.eq("card_id", cardId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
