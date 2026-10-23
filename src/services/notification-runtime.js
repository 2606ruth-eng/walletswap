const DAY_MS = 24 * 60 * 60 * 1000;

export function notificationIdFromString(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 1) || 1;
}

export async function resolveNotificationPermission(state, requestPermission) {
  if (state === "granted" || state === "denied" || state === "unavailable") return state;
  if (!["prompt", "prompt-with-rationale", "default"].includes(state)) return "unavailable";
  return requestPermission();
}

function safeRetailer(value) {
  const label = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 48);
  return label && label !== "other" ? label : "Your";
}

export function safeStoredNotificationContent(type) {
  const messages = {
    purchase: ["Card activity recorded", "A user-reported card activity update is ready in WalletSwap."],
    balance_change: ["Card balance update", "A balance change is ready to review in WalletSwap."],
    test_balance_change: ["Test balance update", "A signed test event is ready to review; it is not a retailer verification."],
    expiry_reminder: ["Gift card expiry reminder", "A card is approaching its printed expiration date."],
    weekly_summary: ["Weekly wallet summary", "Your WalletSwap activity summary is ready."],
    marketplace: ["Marketplace activity", "A simulated transaction is ready to review. No payment or card transfer occurred."],
    swap: ["Swap activity", "A simulated swap proposal is ready to review. No card transfer occurred."],
  };
  const [title, body] = messages[type] || ["WalletSwap alert", "Open WalletSwap to review."];
  return { title, body };
}

export function buildExpiryNotifications(cards, now = new Date()) {
  const notifications = [];
  for (const card of cards || []) {
    if (!card?.id || typeof card.expires !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(card.expires)) continue;
    const expiresAt = new Date(`${card.expires}T09:00:00`);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) continue;
    for (const daysBefore of [14, 1]) {
      const at = new Date(expiresAt.getTime() - daysBefore * DAY_MS);
      if (at <= now) continue;
      notifications.push({
        id: notificationIdFromString(`expiry:${card.id}:${daysBefore}`),
        title: "Gift card expiring soon",
        body: `${safeRetailer(card.brand)} gift card expires on ${expiresAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`,
        schedule: { at },
        extra: { walletswapType: "expiry" },
      });
    }
  }
  return notifications;
}
