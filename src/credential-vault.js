import { Capacitor } from "@capacitor/core";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";

const KEY_PREFIX = "walletswap_credentials_v1";
let initialized = false;

export function hasNativeCredentialVault() {
  return Capacitor.isNativePlatform();
}

export async function initializeCredentialVault() {
  if (!hasNativeCredentialVault() || initialized) return;
  await SecureStorage.setKeyPrefix(KEY_PREFIX);
  await SecureStorage.setSynchronize(false);
  initialized = true;
}

export async function storeCardCredentials(card) {
  if (!hasNativeCredentialVault()) return false;
  await initializeCredentialVault();
  await SecureStorage.set(`card:${card.id}`, {
    number: String(card.number || "").replace(/\D/g, ""),
    pin: String(card.pin || "").replace(/\D/g, ""),
  }, false, false);
  return true;
}

export async function loadCardCredentials(cardId) {
  if (!hasNativeCredentialVault()) return null;
  await initializeCredentialVault();
  const value = await SecureStorage.get(`card:${cardId}`, false, false);
  if (!value || typeof value !== "object") return null;
  const number = String(value.number || "").replace(/\D/g, "");
  const pin = String(value.pin || "").replace(/\D/g, "");
  return { number, pin };
}

export async function removeCardCredentials(cardId) {
  if (!hasNativeCredentialVault()) return;
  await initializeCredentialVault();
  await SecureStorage.remove(`card:${cardId}`, false);
}

export async function protectCardCredentials(cards) {
  await initializeCredentialVault();
  for (const card of cards) {
    if (card.number || card.pin) await storeCardCredentials(card);
    const credentials = await loadCardCredentials(card.id);
    if (credentials) {
      card.number = credentials.number;
      card.pin = credentials.pin;
    } else if (!hasNativeCredentialVault()) {
      delete card.number;
      delete card.pin;
    }
    card.last4 = card.last4 || String(card.number || "").replace(/\D/g, "").slice(-4);
    card.balanceVerification = card.balanceVerification || "user-reported";
  }
}
