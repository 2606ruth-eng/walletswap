import { getPublicListings } from "./marketplace.js";
import { getNotifications, getNotificationPreferences } from "./notifications.js";
import { getCardActivity, getWalletCards } from "./wallet.js";
import { requireSupabase } from "./supabase.js";

const ACTIVITY_KIND = {
  added: "added",
  purchase: "redeemed",
  balance_adjustment: "edited",
  verification_update: "edited",
  archived: "removed",
  listed: "listed",
  unlisted: "unlisted",
};

export async function loadRemoteAccount(user) {
  const client = requireSupabase();
  const [{ data: profile, error: profileError }, cards, activity, market, preferences, notifications] = await Promise.all([
    client.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    getWalletCards(),
    getCardActivity(),
    getPublicListings(),
    getNotificationPreferences(),
    getNotifications(20),
  ]);
  if (profileError) throw profileError;
  const cardsById = new Map(cards.map(card => [card.id, card]));
  const mappedActivity = activity.map(item => {
    const card = cardsById.get(item.card_id);
    return {
      id: item.id,
      t: new Date(item.created_at).getTime(),
      kind: ACTIVITY_KIND[item.activity_type] || "edited",
      brand: card?.brand || "",
      brandName: card?.brandName || "",
      cardId: item.card_id,
      amount: Number(item.amount || 0),
      sub: item.data_source === "user_reported" ? "User-reported; not externally verified" : "WalletSwap activity",
      verificationStatus: item.verification_status,
      requiresReview: item.requires_review === true,
      problemReported: Boolean(item.problem_reported_at),
    };
  });
  return {
    id: user.id,
    email: String(user.email || "").toLowerCase(),
    name: profile?.display_name || user.user_metadata?.display_name || user.email || "WalletSwap user",
    demo: false,
    data: {
      cards,
      activity: mappedActivity,
      notifications,
      market,
      saved: 0,
      payment: null,
      payout: { method: null, balance: 0 },
      prefs: {
        saleAlerts: preferences?.marketplace_alerts_enabled ?? true,
        cardActivityAlerts: preferences?.card_activity_enabled ?? true,
        balanceChangeAlerts: preferences?.balance_change_enabled ?? true,
        expiryReminders: preferences?.expiry_reminders_enabled ?? true,
        weeklySummary: preferences?.weekly_summary_enabled ?? false,
        share: false,
        hide: false,
      },
    },
  };
}
