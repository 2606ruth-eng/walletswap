const SAFE_ERROR_CATEGORIES = new Set([
  "provider_not_configured",
  "unsupported_card_type",
  "provider_timeout",
  "provider_refused",
  "invalid_provider_response",
  "unsupported_currency",
  "rate_limited",
  "duplicate_request",
  "unknown",
]);

export function safeProviderErrorCategory(value) {
  return SAFE_ERROR_CATEGORIES.has(value) ? value : "unknown";
}

export function validateNormalizedProviderResult(result, expectedCurrency, maximumMinorUnits) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("invalid_provider_response");
  }
  if (result.status !== "success") throw new Error("provider_refused");
  if (
    result.currency !== expectedCurrency
    || !Number.isSafeInteger(result.balanceMinor)
    || result.balanceMinor < 0
    || result.balanceMinor > maximumMinorUnits
  ) throw new Error("invalid_provider_response");

  return { balanceMinor: result.balanceMinor, currency: result.currency };
}

const TWO_DECIMAL_CURRENCIES = new Set([
  "USD", "EUR", "CAD", "GBP", "AUD", "NZD", "CHF", "SGD", "HKD", "MXN", "BRL",
]);
const ADYEN_ONLINE_STORED_VALUE_TYPES = new Set(["svs", "valuelink"]);

export function buildAdyenCheckBalanceRequest({
  merchantAccount,
  reference,
  store,
  storedValueType,
  credentials,
}) {
  if (typeof merchantAccount !== "string" || !merchantAccount.trim() || merchantAccount.length > 80) {
    throw new Error("provider_not_configured");
  }
  if (typeof reference !== "string" || !reference || reference.length > 80) {
    throw new Error("invalid_provider_response");
  }
  if (store !== undefined && (typeof store !== "string" || store.length > 16)) {
    throw new Error("invalid_provider_response");
  }
  if (!ADYEN_ONLINE_STORED_VALUE_TYPES.has(storedValueType)) throw new Error("unsupported_card_type");
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
    throw new Error("provider_not_configured");
  }
  const { number, securityCode, expiryMonth, expiryYear, holderName } = credentials;
  if (typeof number !== "string" || !/^\d{8,19}$/.test(number)) {
    throw new Error("provider_not_configured");
  }
  if (securityCode !== undefined && (typeof securityCode !== "string" || !/^\d{3,8}$/.test(securityCode))) {
    throw new Error("provider_not_configured");
  }

  const paymentMethod = { type: storedValueType, number };
  if (securityCode !== undefined) paymentMethod.securityCode = securityCode;
  if (expiryMonth !== undefined) paymentMethod.expiryMonth = String(expiryMonth);
  if (expiryYear !== undefined) paymentMethod.expiryYear = String(expiryYear);
  if (holderName !== undefined) paymentMethod.holderName = String(holderName).slice(0, 80);

  return {
    merchantAccount: merchantAccount.trim(),
    reference,
    ...(store === undefined ? {} : { store }),
    paymentMethod,
  };
}

export function parseAdyenCheckBalanceResponse(response, expectedCurrency, maximumMinorUnits) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("invalid_provider_response");
  }
  if (response.resultCode !== "Success") throw new Error("provider_refused");
  const amount = response.currentBalance;
  if (!amount || typeof amount !== "object" || Array.isArray(amount)) {
    throw new Error("invalid_provider_response");
  }
  if (!TWO_DECIMAL_CURRENCIES.has(amount.currency)) throw new Error("unsupported_currency");
  if (
    amount.currency !== expectedCurrency
    || !Number.isSafeInteger(amount.value)
    || amount.value < 0
    || amount.value > maximumMinorUnits
  ) throw new Error("invalid_provider_response");
  return { status: "success", balanceMinor: amount.value, currency: amount.currency, testData: true };
}

export function createAdyenTestAdapter(configuration, fetchProvider = fetch, timeoutMs = 10_000) {
  const ready = configuration?.enabled === true
    && configuration?.schemaVerified === true
    && typeof configuration.apiKey === "string"
    && configuration.apiKey.length > 0
    && typeof configuration.merchantAccount === "string"
    && configuration.merchantAccount.length > 0
    && /^\d{1,3}$/.test(String(configuration.apiVersion || ""))
    && ADYEN_ONLINE_STORED_VALUE_TYPES.has(configuration.storedValueType);

  return Object.freeze({
    providerId: "adyen",
    supportsCard({ cardType, currency }) {
      return ready
        && ["physical", "digital"].includes(cardType)
        && TWO_DECIMAL_CURRENCIES.has(currency);
    },
    async checkBalance({ card, credentials, requestId, store }) {
      if (!this.supportsCard({ cardType: card?.card_type, currency: card?.currency })) {
        throw new Error("provider_not_configured");
      }
      const requestBody = buildAdyenCheckBalanceRequest({
        merchantAccount: configuration.merchantAccount,
        reference: requestId,
        store,
        storedValueType: configuration.storedValueType,
        credentials,
      });
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) {
        throw new Error("provider_not_configured");
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const url = `https://pal-test.adyen.com/pal/servlet/StoredValue/v${configuration.apiVersion}/checkBalance`;
      try {
        const response = await fetchProvider(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": configuration.apiKey },
          body: JSON.stringify(requestBody),
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("provider_refused");
        let body;
        try {
          body = await response.json();
        } catch {
          throw new Error("invalid_provider_response");
        }
        return parseAdyenCheckBalanceResponse(
          body,
          card.currency,
          Math.round(Number(card.original_value) * 100),
        );
      } catch (error) {
        if (error instanceof Error && error.message === "provider_refused") throw error;
        if (controller.signal.aborted) throw new Error("provider_timeout");
        if (error instanceof Error && error.message === "invalid_provider_response") throw error;
        throw new Error("provider_refused");
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

function disabledAdapter(providerId) {
  return Object.freeze({
    providerId,
    supportsCard: () => false,
    async checkBalance() {
      throw new Error("provider_not_configured");
    },
  });
}

export const CARD_BALANCE_PROVIDERS = Object.freeze({
  adyen: disabledAdapter("adyen"),
  tillo: disabledAdapter("tillo"),
  incomm: disabledAdapter("incomm"),
  direct_merchant: disabledAdapter("direct_merchant"),
});

export function getCardBalanceProvider(providerId) {
  return CARD_BALANCE_PROVIDERS[providerId] || null;
}

export const ADYEN_TEST_ADAPTER_STATUS =
  "Disabled by default. The request builder is prepared, but credentials are not accepted by the Edge Function; the API version still requires authorized API Explorer validation and the credential path requires separate security review.";
