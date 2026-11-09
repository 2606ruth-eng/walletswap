// Returns a safe, normalized LinkedIn company-page URL or "" when unset/invalid.
// The URL is supplied by the owner via VITE_LINKEDIN_COMPANY_URL; nothing is invented.
export function resolveLinkedInCompanyUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  const host = url.hostname.toLowerCase();
  const linkedInHost = host === "linkedin.com" || host.endsWith(".linkedin.com");
  if (url.protocol !== "https:" || !linkedInHost || url.username || url.password) return "";
  if (!/^\/(company|showcase)\/[^/]+\/?/.test(url.pathname)) return "";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export const LINKEDIN_COMPANY_URL = resolveLinkedInCompanyUrl(import.meta.env?.VITE_LINKEDIN_COMPANY_URL);
