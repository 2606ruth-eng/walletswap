import { requireSupabase } from "./supabase.js";
import { centsToDecimal, dollarsToCents } from "./wallet.js";

const LEGACY_KEY = "walletswap.state.v1";

export function readLegacyAccount(email, storage = window.localStorage) {
  const raw = storage.getItem(LEGACY_KEY);
  if (!raw) return null;
  let state;
  try {
    state = JSON.parse(raw);
  } catch {
    throw new Error("The saved local wallet could not be read. Its data has not been changed.");
  }
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const account = Object.values(state?.accounts || {}).find(item =>
    String(item?.email || "").trim().toLowerCase() === normalizedEmail && !item.demo
  );
  if (!account) return null;
  return {
    email: normalizedEmail,
    cards: (account.data?.cards || []).map(card => ({
      retailer: String(card.brand || "").trim().toLowerCase(),
      nickname: String(card.brand === "other" ? card.brandName : card.nickname || "").trim().slice(0, 80),
      card_type: String(card.type || "").toLowerCase(),
      currency: String(card.currency || "USD").toUpperCase(),
      original_value: centsToDecimal(dollarsToCents(card.original)),
      reported_balance: centsToDecimal(dollarsToCents(card.balance)),
      expiration_date: card.expires || null,
      masked_identifier: String(card.last4 || String(card.number || "").replace(/\D/g, "").slice(-4)).replace(/\D/g, "").slice(-4),
    })),
  };
}

export async function importLegacyWallet(email, { confirmed = false, idempotencyKey = crypto.randomUUID() } = {}) {
  if (confirmed !== true) throw new Error("Confirm the local wallet import before continuing.");
  const legacy = readLegacyAccount(email);
  if (!legacy) throw new Error("No non-demo local wallet is available for this signed-in email.");
  if (legacy.cards.length > 100) throw new Error("Import at most 100 cards per batch.");
  const { data, error } = await requireSupabase().rpc("import_legacy_cards", {
    p_cards: legacy.cards,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  return { importedCount: Number(data?.imported_count || 0), sourceCount: legacy.cards.length };
}
