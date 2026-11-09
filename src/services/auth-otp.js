export const RESEND_COOLDOWN_SECONDS = 60;
const OTP_PATTERN = /^\d{6,10}$/;

export function normalizeOtpCode(value) {
  return String(value || "").replace(/[\s-]/g, "");
}

export function validateOtpCode(value) {
  return OTP_PATTERN.test(normalizeOtpCode(value)) ? "" : "Enter the numeric code from your email.";
}

export function resendSecondsRemaining(sentAt, now = Date.now()) {
  if (!sentAt) return 0;
  return Math.max(0, Math.ceil((sentAt + RESEND_COOLDOWN_SECONDS * 1000 - now) / 1000));
}

// Supabase reports an expired and a wrong code identically (otp_expired), so the wording must cover both.
export function classifyOtpError(error) {
  const code = String(error?.code || "");
  const status = Number(error?.status || 0);
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || status === 429) {
    return { kind: "rate-limited", message: "Too many attempts. Wait a moment, then try again." };
  }
  if (code === "otp_expired" || code === "otp_disabled" || status === 403 || status === 422 || status === 400) {
    return { kind: "invalid", message: "That code is incorrect or has expired. Check the latest email or request a new code." };
  }
  if (/fetch|network/i.test(String(error?.name || error?.message || ""))) {
    return { kind: "unavailable", message: "WalletSwap couldn't reach the server. Check your connection and try again." };
  }
  return { kind: "unknown", message: "WalletSwap couldn't verify that code. Try again or request a new code." };
}
