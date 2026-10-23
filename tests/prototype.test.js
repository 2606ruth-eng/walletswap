import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [entry, prototype, capacitorConfig] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../Mockup.html", import.meta.url), "utf8"),
  readFile(new URL("../capacitor.config.json", import.meta.url), "utf8"),
]);

test("original mockup is retained and the Vite entry preserves its app structure", () => {
  for (const feature of ["<div id=\"root\"></div>", "function processSales()", "function vWallet(", "function vMarket("]) {
    assert.ok(prototype.includes(feature), `original prototype is missing ${feature}`);
    assert.ok(entry.includes(feature), `app entry is missing ${feature}`);
  }
});

test("prototype script parses and retains its existing app flows", () => {
  const scripts = [...entry.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1, "expected one inline application script");
  const source = scripts[0][1].replace(/^import\s.+;\s*$/gm, "");
  assert.doesNotThrow(() => new vm.Script(source));

  for (const feature of [
    "function render()",
    "function appShell(",
    "function processSales()",
    "const ACTIONS =",
    "const FORMS =",
    'case "market"',
    'case "activity"',
  ]) {
    assert.ok(scripts[0][1].includes(feature), `missing existing app feature: ${feature}`);
  }
});

test("prototype is configured for mobile and uses no missing external assets", () => {
  assert.match(entry, /name="viewport"[^>]*width=device-width[^>]*viewport-fit=cover/i);
  assert.match(entry, /@media\s*\(max-width:/i);
  assert.doesNotMatch(entry, /<(?:script|img|source|video)\b[^>]*(?:src|poster)=["'](?:\.{1,2}\/|\/)/i);
  assert.doesNotMatch(entry, /<link\b[^>]*href=["'](?:\.{1,2}\/|\/)/i);
});

test("camera capture uses local device APIs and never uploads scans to an AI service", () => {
  assert.match(entry, /@capacitor\/camera/);
  assert.match(entry, /@capacitor-mlkit\/barcode-scanning/);
  assert.match(entry, /@capacitor-mlkit\/text-recognition/);
  assert.match(entry, /BarcodeScanner\.installGoogleBarcodeScannerModule/);
  for (const option of ["Scan Barcode / QR Code", "Take Photo of Gift Card", "Enter Details Manually"]) {
    assert.ok(entry.includes(option), `missing capture option: ${option}`);
  }
  assert.doesNotMatch(entry, /fetch\s*\(\s*["'][^"']*(?:openai|chat\/completions)/i);
});

test("native camera permission prompts are configured", async () => {
  const manifest = await readFile(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
  const plist = await readFile(new URL("../ios/App/App/Info.plist", import.meta.url), "utf8");
  assert.match(manifest, /android\.permission\.CAMERA/);
  assert.match(plist, /<key>NSCameraUsageDescription<\/key>/);
  assert.match(manifest, /android:scheme="walletswap"[^>]*android:host="auth"/);
  assert.match(plist, /<key>CFBundleURLSchemes<\/key>[\s\S]*?<string>walletswap<\/string>/);
});

test("Capacitor uses the WalletSwap identity and Vite output directory", () => {
  assert.deepEqual(JSON.parse(capacitorConfig), {
    appId: "com.walletswap.app",
    appName: "WalletSwap",
    webDir: "dist",
    plugins: {
      LocalNotifications: { presentationOptions: ["badge", "sound", "banner", "list"] },
      PushNotifications: { presentationOptions: ["badge", "sound", "banner", "list"] },
    },
  });
});
