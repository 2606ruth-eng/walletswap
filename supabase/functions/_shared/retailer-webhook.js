function toHex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function signWebhookBody(secret, rawBody, cryptoProvider = globalThis.crypto) {
  if (!secret || !cryptoProvider?.subtle) throw new Error("Webhook signing is unavailable.");
  const key = await cryptoProvider.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await cryptoProvider.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return `sha256=${toHex(signature)}`;
}

export async function verifyWebhookSignature(secret, rawBody, provided, cryptoProvider = globalThis.crypto) {
  if (typeof provided !== "string" || !/^sha256=[a-f0-9]{64}$/i.test(provided)) return false;
  const expected = await signWebhookBody(secret, rawBody, cryptoProvider);
  const actualHex = provided.slice(7).toLowerCase();
  const expectedHex = expected.slice(7);
  let difference = actualHex.length ^ expectedHex.length;
  for (let i = 0; i < expectedHex.length; i += 1) {
    difference |= expectedHex.charCodeAt(i) ^ (actualHex.charCodeAt(i) || 0);
  }
  return difference === 0;
}

export function validateBalanceWebhook(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Webhook payload is invalid.");
  const allowed = new Set(["provider", "event_id", "card_id", "balance", "currency", "test_event"]);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error("Webhook payload contains unsupported fields.");
  if (typeof value.provider !== "string" || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(value.provider)) {
    throw new Error("Webhook provider is invalid.");
  }
  if (typeof value.event_id !== "string" || value.event_id.length < 8 || value.event_id.length > 128) {
    throw new Error("Webhook event identifier is invalid.");
  }
  if (typeof value.card_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.card_id)) {
    throw new Error("Webhook card identifier is invalid.");
  }
  const balanceCents = Math.round(Number(value.balance) * 100);
  if (typeof value.balance !== "number" || !Number.isFinite(value.balance) || value.balance < 0
      || value.balance > 200000 || !Number.isSafeInteger(balanceCents)
      || Math.abs(balanceCents - value.balance * 100) > 0.000001) {
    throw new Error("Webhook balance is invalid.");
  }
  if (typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency)) {
    throw new Error("Webhook currency is invalid.");
  }
  if (value.test_event !== undefined && typeof value.test_event !== "boolean") {
    throw new Error("Webhook test marker is invalid.");
  }
  if ((value.provider === "walletswap-test") !== (value.test_event === true)) {
    throw new Error("Test events must use the dedicated test provider and marker.");
  }
  return value;
}
