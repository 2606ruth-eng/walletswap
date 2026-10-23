# WalletSwap Phase 1B QA Report

## Summary

The Add Card capture flows remain connected to the existing WalletSwap interface. Barcode values are shown only as masked previews; OCR runs through the native on-device text-recognition plugin and only produces candidate retailer, printed face value, and expiry fields. The reported remaining balance is entered and confirmed separately. No captured image or complete scan value is sent to the Ruby/OpenAI service.

The CocoaPods migration was not performed. The existing iOS project is Capacitor 8.5.3's Swift Package Manager project, while both selected ML Kit plugins require CocoaPods and do not provide `Package.swift`. This Windows environment has no `pod`, Ruby, or Xcode toolchain, so recreating the native project and validating restoration of its customizations cannot be done safely here. The existing project was checkpointed before this assessment.

## Passed

- `npm.cmd test`: 29 tests passed, 0 failed. Coverage includes successful masked scanning, camera permission denial for scanning and photography, unreadable scans, scanner and photo cancellation, OCR candidate filtering, invalid balances, manual correction/confirmation, browser fallback, and temporary-photo cleanup.
- `npm.cmd run build`: Vite production build passed.
- `npx.cmd cap sync android`: passed; Capacitor found six Android plugins, including ML Kit barcode scanning, text recognition, and Camera.
- `npx.cmd cap sync ios`: command completed and synced web assets, but reported that both ML Kit plugins lack `Package.swift`; completion does not mean iOS scanning or OCR is integrated.
- `index.html` retains the WalletSwap entry and Add Card capture actions; `Mockup.html` remains present. Existing tests check app identity, mobile viewport, original screens, permission declarations, manual entry, and that scan/photo inputs are not sent directly to an AI endpoint.
- Android manifest retains camera permission, optional camera hardware declaration, and WalletSwap app deep-link configuration.
- iOS retains the camera privacy description, WalletSwap URL scheme, app identity, and iOS 15.0 deployment target.
- Backup checkpoint created before native migration assessment: `20478b5` (`Checkpoint iOS project before CocoaPods migration`).

## Failed

- None of the automated checks run in this environment failed.

## Untested

- Physical-device camera permission prompts, barcode/QR recognition, photo capture, OCR accuracy, retry behavior, and screen layout on Android and iPhone.
- Android Gradle/native build and browser interaction in a running web preview.
- iOS camera/photo behavior on a physical device.

## Blocked

- **iOS barcode scanning and OCR:** both selected plugins require CocoaPods. The existing project is SPM-based; `cap sync ios` confirms that both plugins lack `Package.swift`, so they are not linked by this project configuration.
- **CocoaPods migration and iOS native build:** unavailable without macOS/Xcode and CocoaPods. `pod`, `ruby`, and `xcodebuild` are not installed here. No claim is made that an iOS build or device test passed.
- The CLI refuses `cap add ios` when an iOS directory already exists and warns that re-adding removes the native project. The existing project was not removed or overwritten.

## Non-destructive macOS migration and verification plan

1. Start from a clean review branch/worktree and retain checkpoint `20478b5` as the recovery point. Do not delete or move the current `ios` directory until a separately generated CocoaPods project has been validated.
2. In a temporary Capacitor fixture using the same Capacitor 8.5.3 packages, run `npx cap add ios --packagemanager CocoaPods`; install CocoaPods dependencies and confirm both ML Kit pods resolve with iOS 15.0 as the minimum deployment target.
3. Compare the generated project to the existing project. Port and review WalletSwap's `com.walletswap.app` identity, display name, `walletswap://` URL handler, `NSCameraUsageDescription`, assets, Swift app/delegate files, project build settings, and `ios/debug.xcconfig`. Keep the Android project unchanged.
4. Only after the temporary scaffold builds successfully, make a second backup of the existing `ios` directory, generate the CocoaPods project at the required location, restore the reviewed customizations, and run `npx cap sync ios` plus `pod install`.
5. Build with Xcode for simulator and device, then test camera denial/grant, barcode and QR scans, cancel/retry, photo capture, on-device OCR, manual correction, and safe masked previews. Confirm that printed face value never populates reported balance and that no full card number, PIN, redemption code, or photo enters logs or AI requests.
6. Review the full diff and the QA report before replacing the current SPM project or opening a PR. Keep the SPM checkpoint available until the CocoaPods build and device checks pass.

## Files changed in this QA completion

- `tests/card-capture.test.js` — added photo-permission-denial and photo-cancellation tests.
- `PHASE_1B_QA_REPORT.md` — this report.

No iOS project files were changed by the sync attempt, and no Supabase or Ruby AI implementation work was performed as part of this completion.
