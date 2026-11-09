const PREFIX = "walletswap.onboarding.v1.";

export function onboardingKey(accountId) {
  return `${PREFIX}${String(accountId || "").toLowerCase()}`;
}

// Fails closed: if storage is unavailable the guide is not forced on the user every launch.
export function hasSeenOnboarding(storage, accountId) {
  if (!accountId) return true;
  try {
    return storage.getItem(onboardingKey(accountId)) === "done";
  } catch {
    return true;
  }
}

export function markOnboardingSeen(storage, accountId) {
  if (!accountId) return;
  try {
    storage.setItem(onboardingKey(accountId), "done");
  } catch {
    /* storage unavailable; hasSeenOnboarding already fails closed */
  }
}
