export function buildDeletionRequestUrl(email, supportEmail = "admin@walletswap.org") {
  const accountEmail = String(email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(accountEmail)) {
    throw new Error("Enter the email address associated with the WalletSwap account.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(supportEmail)) {
    throw new Error("The support address is not configured correctly.");
  }
  const subject = "WalletSwap account and data deletion request";
  const body = [
    "Please process an account and associated data deletion request for this WalletSwap account:",
    accountEmail,
    "",
    "I understand this email is a request and that the account is not deleted until WalletSwap confirms completion.",
  ].join("\n");
  return `mailto:${supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
