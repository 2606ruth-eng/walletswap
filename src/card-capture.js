const BARCODE_FORMATS = [
  "QR_CODE",
  "AZTEC",
  "CODABAR",
  "CODE_39",
  "CODE_93",
  "CODE_128",
  "DATA_MATRIX",
  "EAN_8",
  "EAN_13",
  "ITF",
  "PDF_417",
  "UPC_A",
  "UPC_E",
];

const RETAILERS = [
  ["amazon", /\bamazon\b/i],
  ["apple", /\bapple\b/i],
  ["bestbuy", /\bbest\s*buy\b/i],
  ["nike", /\bnike\b/i],
  ["sephora", /\bsephora\b/i],
  ["starbucks", /\bstarbucks\b/i],
  ["target", /\btarget\b/i],
  ["walmart", /\bwalmart\b/i],
  ["uber", /\buber\b/i],
  ["airbnb", /\bairbnb\b/i],
  ["homedepot", /\bhome\s*depot\b/i],
  ["steam", /\bsteam\b/i],
];

export function maskIdentifier(value) {
  const normalized = String(value || "").replace(/\s/g, "");
  if (!normalized) return "";
  return `${"•".repeat(Math.min(12, Math.max(4, normalized.length - 4)))}${normalized.slice(-4)}`;
}

export function retailerFromText(value) {
  const text = String(value || "");
  return RETAILERS.find(([, pattern]) => pattern.test(text))?.[0] || "";
}

function normalizeExpiry(value) {
  const shortDate = /^(\d{1,2})\/(\d{2}|\d{4})$/.exec(value);
  if (shortDate) {
    const month = Number(shortDate[1]);
    const year = shortDate[2].length === 2 ? 2000 + Number(shortDate[2]) : Number(shortDate[2]);
    if (month < 1 || month > 12 || year < new Date().getFullYear()) return "";
    return `${year}-${String(month).padStart(2, "0")}-01`;
  }

  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!date) return "";
  const parsed = new Date(`${value}T12:00:00`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : "";
}

export function parseOcrCandidates(text) {
  const source = String(text || "");
  const result = { brand: retailerFromText(source), original: "", expires: "" };
  const amount = /(?:face\s+value|original(?:\s+card)?\s+value|initial\s+value)\s*[:\-]?\s*\$?\s*(\d{1,4}(?:,\d{3})?(?:\.\d{1,2})?)/i.exec(source);
  if (amount) {
    const value = Number(amount[1].replace(/,/g, ""));
    if (Number.isFinite(value) && value > 0 && value <= 2000) result.original = String(value);
  }
  const expiry = /(?:exp(?:ires?|iration|iry)?|valid\s+(?:thru|through|until))\s*[:\-]?\s*(\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i.exec(source);
  if (expiry) result.expires = normalizeExpiry(expiry[1]);
  return result;
}

export function applyRecognizedDetails(form, candidates) {
  const updated = { ...form };
  if (candidates.brand) {
    updated.brand = candidates.brand;
    updated.brandName = candidates.brand.startsWith("custom-") ? updated.brandName : "";
  }
  if (candidates.original) updated.original = candidates.original;
  if (candidates.expires) updated.expires = candidates.expires;
  updated.captureConfirmed = false;
  return updated;
}

export function validateReportedBalance(value, original) {
  const raw = String(value ?? "").trim();
  if (!raw) return "Enter the remaining balance reported by the retailer.";
  const match = /^\$?((?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?)$/.exec(raw);
  if (!match) return "Enter a valid remaining balance.";
  const balance = Number(match[1].replace(/,/g, ""));
  const faceValue = Number(String(original).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(balance) || balance < 0) return "Enter a valid remaining balance.";
  if (balance > faceValue) return "The remaining balance can't exceed the original value.";
  return "";
}

export function safeCardSnapshot(state, last4) {
  const snapshot = JSON.parse(JSON.stringify(state));
  for (const account of Object.values(snapshot.accounts || {})) {
    for (const card of account.data?.cards || []) {
      card.last4 = card.last4 || last4(card.number);
      delete card.number;
      delete card.pin;
    }
  }
  return snapshot;
}

function isPermissionGranted(result) {
  return result?.camera === "granted";
}

function isCancellation(error) {
  return /cancel/i.test(String(error?.code || error?.message || ""));
}

export function createCardCapture({ camera, scanner, textRecognition, filesystem, isNative, onState }) {
  let currentPhotoPath = "";
  let currentPreviewUrl = "";
  let currentObjectUrl = false;
  let state = { status: "idle" };

  const update = next => {
    state = next;
    onState({ ...state });
  };

  const cleanupPhoto = async () => {
    const path = currentPhotoPath;
    const preview = currentPreviewUrl;
    const isObjectUrl = currentObjectUrl;
    if (path && isNative) await filesystem.deleteFile({ path });
    if (isObjectUrl && preview) URL.revokeObjectURL(preview);
    currentPhotoPath = "";
    currentPreviewUrl = "";
    currentObjectUrl = false;
  };

  const checkCameraPermission = async plugin => {
    const permission = await plugin.checkPermissions();
    if (isPermissionGranted(permission)) return true;
    const requested = await plugin.requestPermissions();
    return isPermissionGranted(requested);
  };

  const scan = async () => {
    if (!isNative) {
      update({ status: "unsupported", message: "Camera scanning isn't available in this browser. Enter the card details manually instead." });
      return;
    }
    update({ status: "scanning", message: "Requesting camera access…" });
    try {
      if (scanner.ensureAvailable) {
        update({ status: "installing", message: "Preparing the barcode scanner…" });
        await scanner.ensureAvailable();
      }
      if (!(await checkCameraPermission(scanner))) {
        update({ status: "permission-denied", message: "Camera access was denied. Allow camera access in Settings or enter the card details manually." });
        return;
      }
      update({ status: "scanning", message: "Point the camera at the barcode or QR code." });
      const { barcodes = [] } = await scanner.scan({ formats: BARCODE_FORMATS });
      const barcode = barcodes[0];
      const value = String(barcode?.rawValue || barcode?.displayValue || "").trim();
      if (!value) {
        update({ status: "no-result", message: "No barcode was read. Try scanning again or enter the details manually." });
        return;
      }
      update({
        status: "scan-result",
        message: "Code read on this device. The full value is not shown or saved; enter the card number manually if required.",
        maskedValue: maskIdentifier(value),
        brand: retailerFromText(value),
      });
    } catch (error) {
      if (isCancellation(error)) {
        update({ status: "cancelled", message: "Scanning was cancelled. Retry or enter the details manually." });
      } else if (/permission/i.test(String(error?.code || error?.message || ""))) {
        update({ status: "permission-denied", message: "Camera access was denied. Allow camera access in Settings or enter the card details manually." });
      } else {
        update({ status: "error", message: "The scanner couldn't start. Retry or enter the details manually." });
      }
    }
  };

  const takePhoto = async () => {
    try {
      await cleanupPhoto();
    } catch {
      update({ status: "error", message: "The previous temporary photo couldn't be removed. Close this screen and try again." });
      return;
    }
    update({ status: "taking-photo", message: "Opening the camera…" });
    try {
      if (isNative && !(await checkCameraPermission(camera))) {
        update({ status: "permission-denied", message: "Camera access was denied. Allow camera access in Settings or enter the details manually." });
        return;
      }
      const photo = await camera.getPhoto({
        quality: 75,
        allowEditing: false,
        resultType: "uri",
        saveToGallery: false,
        source: "camera",
        webUseInput: true,
      });
      const photoPath = photo.uri || photo.path || "";
      currentPhotoPath = photoPath;
      currentPreviewUrl = photo.webPath || "";
      currentObjectUrl = !isNative && currentPreviewUrl.startsWith("blob:");
      if (!currentPreviewUrl) {
        await cleanupPhoto();
        update({ status: "error", message: "The camera didn't return a preview. Retry or enter details manually." });
        return;
      }
      if (!isNative || !photoPath) {
        update({
          status: "photo-ready",
          previewUrl: currentPreviewUrl,
          candidates: null,
          message: "Photo captured for this session only. Browser OCR isn't available; enter details manually.",
        });
        return;
      }
      update({ status: "recognizing", previewUrl: currentPreviewUrl, message: "Reading text on this device…" });
      try {
        const { text } = await textRecognition.processImage({ path: photoPath });
        const candidates = parseOcrCandidates(text);
        update({
          status: "photo-ready",
          previewUrl: currentPreviewUrl,
          candidates,
          message: "Possible details were read on this device. Review and correct every suggestion before saving.",
        });
      } catch {
        update({
          status: "photo-unreadable",
          previewUrl: currentPreviewUrl,
          candidates: null,
          message: "Text couldn't be read. Retry the photo or enter details manually.",
        });
      }
    } catch (error) {
      if (isCancellation(error)) {
        update({ status: "cancelled", message: "Photo capture was cancelled. Retry or enter the details manually." });
      } else if (/permission/i.test(String(error?.code || error?.message || ""))) {
        update({ status: "permission-denied", message: "Camera access was denied. Allow camera access in Settings or enter the details manually." });
      } else {
        update({ status: "error", message: "The camera couldn't open. Retry or enter the details manually." });
      }
    }
  };

  const discardPhoto = async () => {
    try {
      await cleanupPhoto();
      update({ status: "idle" });
      return true;
    } catch {
      update({ status: "error", message: "The temporary photo couldn't be removed. Try again before leaving this screen." });
      return false;
    }
  };

  return { scan, takePhoto, discardPhoto, get state() { return { ...state }; } };
}
