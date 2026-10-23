import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRecognizedDetails,
  createCardCapture,
  maskIdentifier,
  parseOcrCandidates,
  safeCardSnapshot,
  validateReportedBalance,
} from "../src/card-capture.js";

function makeCapture(overrides = {}) {
  let state = { status: "idle" };
  const dependencies = {
    isNative: true,
    onState: value => { state = value; },
    camera: {
      checkPermissions: async () => ({ camera: "granted" }),
      requestPermissions: async () => ({ camera: "granted" }),
      getPhoto: async () => ({ uri: "file:///temporary/card.jpg", webPath: "capacitor://temporary/card.jpg" }),
    },
    scanner: {
      checkPermissions: async () => ({ camera: "granted" }),
      requestPermissions: async () => ({ camera: "granted" }),
      scan: async () => ({ barcodes: [{ rawValue: "1234567890123456" }] }),
    },
    textRecognition: { processImage: async () => ({ text: "Amazon Face value: $50 Expires: 12/29" }) },
    filesystem: { deleteFile: async () => {} },
    ...overrides,
  };
  return { capture: createCardCapture(dependencies), getState: () => state };
}

test("successful barcode scanning returns only a masked identifier and retailer candidate", async () => {
  const { capture, getState } = makeCapture({
    scanner: {
      checkPermissions: async () => ({ camera: "granted" }),
      requestPermissions: async () => ({ camera: "granted" }),
      scan: async () => ({ barcodes: [{ rawValue: "1234567890123456" }] }),
    },
  });

  await capture.scan();

  assert.equal(getState().status, "scan-result");
  assert.equal(getState().maskedValue, "••••••••••••3456");
  assert.equal(JSON.stringify(getState()).includes("1234567890123456"), false);
});

test("Android scanner setup completes before opening the scanner", async () => {
  const calls = [];
  const { capture, getState } = makeCapture({
    scanner: {
      ensureAvailable: async () => { calls.push("prepare"); },
      checkPermissions: async () => ({ camera: "granted" }),
      requestPermissions: async () => ({ camera: "granted" }),
      scan: async () => { calls.push("scan"); return { barcodes: [{ rawValue: "12345678" }] }; },
    },
  });

  await capture.scan();

  assert.deepEqual(calls, ["prepare", "scan"]);
  assert.equal(getState().status, "scan-result");
});

test("camera permission denial stops scanning with a manual fallback", async () => {
  let scanCalled = false;
  const { capture, getState } = makeCapture({
    scanner: {
      checkPermissions: async () => ({ camera: "prompt" }),
      requestPermissions: async () => ({ camera: "denied" }),
      scan: async () => { scanCalled = true; return { barcodes: [] }; },
    },
  });

  await capture.scan();

  assert.equal(getState().status, "permission-denied");
  assert.equal(scanCalled, false);
  assert.match(getState().message, /manually/);
});

test("camera permission denial stops photo capture before opening the camera", async () => {
  let photoCalled = false;
  let permissionRequested = false;
  const { capture, getState } = makeCapture({
    camera: {
      checkPermissions: async () => ({ camera: "prompt" }),
      requestPermissions: async () => {
        permissionRequested = true;
        return { camera: "denied" };
      },
      getPhoto: async () => {
        photoCalled = true;
        return { webPath: "capacitor://temporary/card.jpg" };
      },
    },
  });

  await capture.takePhoto();

  assert.equal(permissionRequested, true);
  assert.equal(photoCalled, false);
  assert.equal(getState().status, "permission-denied");
  assert.match(getState().message, /manually/);
});

test("an unreadable barcode offers a retry without retaining a scanned value", async () => {
  const { capture, getState } = makeCapture({
    scanner: {
      checkPermissions: async () => ({ camera: "granted" }),
      requestPermissions: async () => ({ camera: "granted" }),
      scan: async () => ({ barcodes: [] }),
    },
  });

  await capture.scan();

  assert.equal(getState().status, "no-result");
  assert.equal(getState().maskedValue, undefined);
  assert.match(getState().message, /Try scanning again/);
});

test("scanner cancellation is recoverable", async () => {
  const { capture, getState } = makeCapture({
    scanner: {
      checkPermissions: async () => ({ camera: "granted" }),
      requestPermissions: async () => ({ camera: "granted" }),
      scan: async () => { throw new Error("User cancelled"); },
    },
  });

  await capture.scan();

  assert.equal(getState().status, "cancelled");
  assert.match(getState().message, /cancelled/);
});

test("photo capture cancellation returns to a recoverable manual-entry state", async () => {
  const { capture, getState } = makeCapture({
    camera: {
      checkPermissions: async () => ({ camera: "granted" }),
      requestPermissions: async () => ({ camera: "granted" }),
      getPhoto: async () => { throw new Error("User cancelled"); },
    },
  });

  await capture.takePhoto();

  assert.equal(getState().status, "cancelled");
  assert.match(getState().message, /enter the details manually/);
});

test("OCR suggests only retailer, explicitly labeled face value, and expiry", () => {
  const result = parseOcrCandidates("Amazon\nFace value: $50.00\nBalance: $12.00\nExpires: 12/29\n1234567890123456");
  assert.deepEqual(result, { brand: "amazon", original: "50", expires: "2029-12-01" });
  assert.equal(Object.hasOwn(result, "balance"), false);
  assert.equal(JSON.stringify(result).includes("1234567890123456"), false);
});

test("invalid and missing reported balances are rejected", () => {
  assert.match(validateReportedBalance("", "50"), /Enter the remaining balance/);
  assert.match(validateReportedBalance("51", "50"), /can't exceed/);
  assert.match(validateReportedBalance("not money", "50"), /valid remaining balance/);
  assert.match(validateReportedBalance("1,2", "50"), /valid remaining balance/);
  assert.equal(validateReportedBalance("0", "50"), "");
  assert.equal(validateReportedBalance("12.50", "50"), "");
  assert.equal(validateReportedBalance("$1,250.00", "2000"), "");
});

test("manual corrections remain editable and require explicit confirmation", () => {
  const recognized = applyRecognizedDetails(
    { brand: "", number: "12345678", pin: "1234", original: "", expires: "", balance: "", captureConfirmed: true },
    { brand: "amazon", original: "50", expires: "2029-12-01" },
  );
  const corrected = { ...recognized, original: "40", expires: "2030-01-01", balance: "23.50" };

  assert.equal(corrected.brand, "amazon");
  assert.equal(corrected.original, "40");
  assert.equal(corrected.expires, "2030-01-01");
  assert.equal(corrected.balance, "23.50");
  assert.equal(corrected.number, "12345678");
  assert.equal(corrected.pin, "1234");
  assert.equal(corrected.captureConfirmed, false);
});

test("photo OCR is on-device and captured files are deleted when discarded", async () => {
  let deletedPath = "";
  let recognizedPath = "";
  const { capture, getState } = makeCapture({
    camera: {
      checkPermissions: async () => ({ camera: "granted" }),
      requestPermissions: async () => ({ camera: "granted" }),
      getPhoto: async () => ({ uri: "file:///temporary/card.jpg", webPath: "capacitor://temporary/card.jpg" }),
    },
    textRecognition: {
      processImage: async ({ path }) => {
        recognizedPath = path;
        return { text: "Target Face value: $75" };
      },
    },
    filesystem: { deleteFile: async ({ path }) => { deletedPath = path; } },
  });

  await capture.takePhoto();
  assert.equal(getState().status, "photo-ready");
  assert.deepEqual(getState().candidates, { brand: "target", original: "75", expires: "" });
  assert.equal(recognizedPath, "file:///temporary/card.jpg");
  assert.equal(await capture.discardPhoto(), true);
  assert.equal(deletedPath, recognizedPath);
  assert.equal(getState().previewUrl, undefined);
});

test("browser photo capture falls back to manual details without running OCR", async () => {
  let ocrCalled = false;
  let revokedUrl = "";
  const revokeObjectURL = URL.revokeObjectURL;
  URL.revokeObjectURL = url => { revokedUrl = url; };
  try {
    const { capture, getState } = makeCapture({
      isNative: false,
      camera: { getPhoto: async () => ({ webPath: "blob:temporary-card" }) },
      textRecognition: { processImage: async () => { ocrCalled = true; return { text: "" }; } },
    });

    await capture.takePhoto();

    assert.equal(getState().status, "photo-ready");
    assert.equal(getState().candidates, null);
    assert.match(getState().message, /enter details manually/);
    assert.equal(ocrCalled, false);
    assert.equal(await capture.discardPhoto(), true);
    assert.equal(revokedUrl, "blob:temporary-card");
  } finally {
    URL.revokeObjectURL = revokeObjectURL;
  }
});

test("failed temporary-photo deletion retains the path so cleanup can be retried", async () => {
  let failDeletion = true;
  let deletionAttempts = 0;
  const { capture, getState } = makeCapture({
    filesystem: {
      deleteFile: async ({ path }) => {
        assert.equal(path, "file:///temporary/card.jpg");
        deletionAttempts += 1;
        if (failDeletion) throw new Error("File deletion failed");
      },
    },
  });

  await capture.takePhoto();
  assert.equal(getState().status, "photo-ready");
  assert.equal(await capture.discardPhoto(), false);
  assert.equal(getState().status, "error");
  failDeletion = false;
  assert.equal(await capture.discardPhoto(), true);
  assert.equal(deletionAttempts, 2);
});

test("secure persistence snapshots keep only the masked card identifier", () => {
  const state = {
    accounts: {
      user: { data: { cards: [{ id: "card-1", number: "1234567890123456", pin: "1234", balance: 20 }] } },
    },
  };

  const snapshot = safeCardSnapshot(state, value => String(value || "").slice(-4));

  assert.deepEqual(snapshot.accounts.user.data.cards[0], {
    id: "card-1",
    last4: "3456",
    balance: 20,
  });
  assert.equal(state.accounts.user.data.cards[0].number, "1234567890123456");
});

test("identifier previews mask the value and handle short codes", () => {
  assert.equal(maskIdentifier("AB123456"), "••••3456");
  assert.equal(maskIdentifier("123"), "••••123");
  assert.equal(maskIdentifier(""), "");
});
