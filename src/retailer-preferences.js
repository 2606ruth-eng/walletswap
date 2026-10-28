const RETAILER_KEY = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export function customRetailerId(name) {
  const label = String(name || "").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 31)
    .replace(/-+$/g, "");
  return label ? `custom-${label}` : "";
}

export function normalizeRetailerSelection(brand, brandName) {
  if (brand === "other") {
    const name = String(brandName || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 48);
    return { retailer: customRetailerId(name), displayName: name };
  }
  if (typeof brand !== "string" || !RETAILER_KEY.test(brand)) return { retailer: "", displayName: "" };
  const name = String(brandName || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 48);
  return { retailer: brand, displayName: brand.startsWith("custom-") ? name : "" };
}

export function rankRecentlyUsedRetailers(activity, limit = 5) {
  const ranked = new Map();
  for (const item of Array.isArray(activity) ? activity : []) {
    const { retailer, displayName } = normalizeRetailerSelection(item.brand, item.brandName);
    if (!retailer || ["removed", "listed", "unlisted"].includes(item.kind)) continue;
    const time = Number(item.t) || 0;
    const entry = ranked.get(retailer) || { retailer, displayName, count: 0, lastUsedAt: 0 };
    entry.count += 1;
    entry.lastUsedAt = Math.max(entry.lastUsedAt, time);
    if (!entry.displayName && displayName) entry.displayName = displayName;
    ranked.set(retailer, entry);
  }
  return [...ranked.values()]
    .sort((a, b) => b.count - a.count || b.lastUsedAt - a.lastUsedAt)
    .slice(0, Math.max(0, Math.floor(limit)));
}
