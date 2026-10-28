const RETAILER_VERIFICATION_DIRECTORY = Object.freeze({
  target: Object.freeze({
    id: "target",
    displayName: "Target",
    officialDomain: "www.target.com",
    officialBalanceUrl: "https://www.target.com/guest/gift-card-balance",
    supportedCardTypes: Object.freeze(["physical", "digital"]),
    verificationMethod: "OFFICIAL_WEBSITE",
    enabled: true,
    authorizedProvider: null,
    credentialsRequired: false,
    lastCheckedAt: "2026-10-28T00:00:00.000Z",
  }),
  starbucks: Object.freeze({
    id: "starbucks",
    displayName: "Starbucks",
    officialDomain: "www.starbucks.com",
    officialBalanceUrl: "https://www.starbucks.com/gift/card/manage",
    supportedCardTypes: Object.freeze(["physical", "digital"]),
    verificationMethod: "OFFICIAL_WEBSITE",
    enabled: true,
    authorizedProvider: null,
    credentialsRequired: false,
    lastCheckedAt: "2026-10-28T00:00:00.000Z",
  }),
});

export function getRetailerVerification(retailer) {
  const entry = RETAILER_VERIFICATION_DIRECTORY[String(retailer || "").toLowerCase()];
  if (entry) return entry;
  return {
    id: String(retailer || "").toLowerCase(),
    displayName: "",
    officialDomain: "",
    officialBalanceUrl: "",
    supportedCardTypes: ["physical", "digital"],
    verificationMethod: "MANUAL_ONLY",
    enabled: false,
    authorizedProvider: null,
    credentialsRequired: false,
    lastCheckedAt: null,
  };
}

export function approvedOfficialBalanceUrl(retailer) {
  const entry = getRetailerVerification(retailer);
  if (!entry.enabled || entry.verificationMethod !== "OFFICIAL_WEBSITE" || !entry.officialBalanceUrl) return "";
  const url = new URL(entry.officialBalanceUrl);
  if (
    url.protocol !== "https:"
    || url.hostname !== entry.officialDomain
    || url.username
    || url.password
    || url.search
    || url.hash
  ) return "";
  return url.href;
}
