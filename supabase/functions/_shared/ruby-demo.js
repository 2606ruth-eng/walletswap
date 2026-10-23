const MONEY = /\$\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)/;

export function classifyRubyDemoIntent(message) {
  const text = String(message || "").toLowerCase();
  if (/\b(verify|verified|valid|check if.*valid)\b/.test(text) && /\b(balance|card|gift card)\b/.test(text)) {
    return { operation: "verification" };
  }
  if (/\b(expir|expire|expiring)\b/.test(text)) {
    const days = /\b7\b|week/.test(text) ? 7 : /\b14\b|two weeks/.test(text) ? 14 : 30;
    return { operation: "expiring", days };
  }
  if (/\b(weekly|week)\b/.test(text) && /\b(summary|summarize|wallet|activity)\b/.test(text)) {
    return { operation: "weekly_summary" };
  }
  if (/\b(activity|transactions|recent activity)\b/.test(text)) return { operation: "activity" };
  if (/\b(swap|trade|exchange)\b/.test(text)) return { operation: "swap" };
  if (/\b(sell|selling|payout|receive|asking price|listing price)\b/.test(text)) {
    const amount = MONEY.exec(text)?.[1]?.replace(/,/g, "");
    return { operation: "sale_estimate", amount: amount || null };
  }
  if (/\b(total|how much|balance|money|value)\b/.test(text)) return { operation: "summary" };
  if (/\b(cards?|wallet|gift cards?)\b/.test(text)) return { operation: "cards" };
  return { operation: "unsupported" };
}

function money(value, currency = "USD") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${currency} 0.00`;
  return `${currency} ${amount.toFixed(2)}`;
}

export function rubyDemoReply(message, data = {}) {
  const intent = classifyRubyDemoIntent(message);
  const cards = Array.isArray(data.cards) ? data.cards : [];
  if (intent.operation === "verification") {
    return {
      mode: "demo",
      reply: "I can't independently verify a gift-card balance right now. WalletSwap has no authorized retailer verification connection, so balances remain user-reported unless an approved integration confirms them.",
    };
  }
  if (intent.operation === "cards") {
    if (!cards.length) return { mode: "demo", reply: "I couldn't find any active gift cards in your WalletSwap account yet. Add a card to see it here." };
    const lines = cards.map(card =>
      `• ${card.nickname ? `${card.nickname} (${card.retailer})` : card.retailer}: ${money(card.reported_balance, card.currency)} reported${card.verification_status === "verified" ? " and verified" : " (unverified)"}`,
    );
    return { mode: "demo", reply: `Your active WalletSwap cards are:\n${lines.join("\n")}` };
  }
  if (intent.operation === "summary") {
    const groups = Array.isArray(data.summary) ? data.summary : [];
    if (!groups.length) return { mode: "demo", reply: "Your wallet has no active reported balances yet." };
    return {
      mode: "demo",
      reply: `Your reported balances are:\n${groups.map(group => `• ${group.currency}: ${money(group.reported_balance, group.currency)} across ${group.card_count} card(s); verified portion: ${money(group.verified_balance, group.currency)}`).join("\n")}\nCurrencies are shown separately and are not combined.`,
    };
  }
  if (intent.operation === "expiring") {
    const rows = Array.isArray(data.expiring) ? data.expiring : [];
    if (!rows.length) return { mode: "demo", reply: `I found no active cards expiring in the next ${intent.days} days.` };
    return { mode: "demo", reply: `Cards with a recorded expiry in the next ${intent.days} days:\n${rows.map(card => `• ${card.nickname || card.retailer}: ${card.expiration_date} (${card.verification_status})`).join("\n")}` };
  }
  if (intent.operation === "activity") {
    const rows = Array.isArray(data.activity) ? data.activity : [];
    if (!rows.length) return { mode: "demo", reply: "There is no recent WalletSwap-recorded card activity." };
    return { mode: "demo", reply: `Recent WalletSwap-recorded activity:\n${rows.slice(0, 10).map(item => `• ${item.activity_type}: ${item.amount ?? "amount not recorded"} on ${new Date(item.created_at).toLocaleDateString("en-US", { timeZone: "UTC" })} (${item.verification_status || "not verified"})`).join("\n")}\nThis does not include retailer activity outside WalletSwap.` };
  }
  if (intent.operation === "weekly_summary") {
    const summary = data.weeklySummary;
    if (!summary) return { mode: "demo", reply: "I couldn't load your weekly WalletSwap summary. No external transaction feed is connected, so activity outside WalletSwap isn't included." };
    const balances = Array.isArray(summary.balances) ? summary.balances : [];
    const activity = Array.isArray(summary.activity) ? summary.activity : [];
    return {
      mode: "demo",
      reply: `Your last-seven-day WalletSwap summary has ${activity.length} recorded activity item(s).${balances.length ? ` Current reported balances: ${balances.map(group => `${group.currency} ${group.reported_balance} across ${group.card_count} card(s)`).join("; ")}.` : " There are no active wallet balances."} User-reported entries are not retailer-verified. No external transaction feed is connected.`,
    };
  }
  if (intent.operation === "sale_estimate") {
    const namedCards = cards.filter(card => {
      const retailer = String(card.retailer || "").toLowerCase();
      const nickname = String(card.nickname || "").toLowerCase();
      const prompt = String(message || "").toLowerCase();
      return retailer && prompt.includes(retailer) || nickname && prompt.includes(nickname);
    });
    const candidates = intent.amount
      ? cards.filter(card => Number(card.reported_balance) === Number(intent.amount))
      : namedCards.length ? namedCards : cards;
    const cardsToPrice = candidates;
    if (!cardsToPrice.length) return { mode: "demo", reply: intent.amount
      ? `I couldn't find an active card with a reported balance of ${money(intent.amount)}. I won't estimate a sale for a card that isn't in your wallet.`
      : "Tell me the retailer or reported balance of the card you want to estimate, and I can check your wallet." };
    if (cardsToPrice.length > 1) return { mode: "demo", reply: "I found more than one matching card. Tell me the retailer or nickname so I estimate the right one." };
    const card = cardsToPrice[0];
    const balance = Math.round(Number(card.reported_balance) * 100);
    if (!Number.isSafeInteger(balance) || balance < 0) return { mode: "demo", reply: "I couldn't safely calculate that estimate from the saved reported balance." };
    const asking = Math.round(balance * 0.9);
    const fee = Math.round(asking * 0.05);
    return {
      mode: "demo",
      reply: `For your ${card.retailer} card (${money(card.reported_balance, card.currency)} reported, ${card.verification_status}), the illustrative estimate is: asking price ${money(asking / 100, card.currency)}, WalletSwap fee ${money(fee / 100, card.currency)}, estimated payout ${money((asking - fee) / 100, card.currency)}. This is only an estimate; it does not create a listing or guarantee a sale.`,
    };
  }
  if (intent.operation === "swap") {
    if (!Array.isArray(data.matches)) return { mode: "demo", reply: "Tell me which retailer card you want to swap, and I can search existing marketplace listings." };
    const matches = Array.isArray(data.matches) ? data.matches : [];
    return matches.length
      ? { mode: "demo", reply: `Existing marketplace listings that may match:\n${matches.slice(0, 10).map(item => `• ${item.retailer}: ${money(item.reported_balance, item.currency)} balance; asking ${money(item.asking_price, item.currency)}`).join("\n")}\nReview listings in WalletSwap before taking any action.` }
      : { mode: "demo", reply: "I couldn't find an eligible matching listing in the current marketplace. No swap has been created." };
  }
  return {
    mode: "demo",
    reply: "Ruby is in Demo Mode and can answer wallet/card, balance, expiry, recorded activity, sale-estimate, marketplace-match, and balance-verification questions from your authorized WalletSwap data. Try one of those actions.",
  };
}
