# Android build and release readiness

## Current state

The Android Capacitor project uses application ID `com.walletswap.app`. The
Windows host lacks Java and the Android SDK, but GitHub Actions successfully
ran `assembleDebug` and uploaded the **debug APK** artifact. Download it from
the successful WalletSwap CI run associated with the draft PR. It is a
device-testing build, not a release-signed Play Store package.

Push delivery is not configured: `android/app/google-services.json` is absent
and there is no verified FCM delivery backend. Local notifications and app
features that do not require push can still be tested independently.

## Device-testing build

On a machine with Android Studio, JDK 21, and Android SDK platform/build tools:

```sh
npm ci
npm run cap:sync:android
cd android
./gradlew assembleDebug
```

The resulting debug APK is
`android/app/build/outputs/apk/debug/app-debug.apk`. Install it only on a
test device/account and verify login/deep links, Add Card manual entry,
barcode/QR scanning, photo capture/OCR, permission denial, purchase simulation,
activity, notifications, and Ruby's honest service-unavailable response until
the live backend is separately enabled.

The CI debug APK is a test artifact, not a store-ready release. Do not use a
debug signing key for distribution. Physical-device installation and feature
testing remain unverified.

## Store release gate

Before creating a Play Store release, confirm the final application ID and
versioning, privacy disclosures, camera/notification permission explanations,
data safety declaration, screenshots, and store listing. Configure a private
release signing key in the build environment's protected secrets; never commit
keystores, passwords, signing properties, or service-account credentials.
Test a signed candidate on physical devices, inspect the artifact, and retain
the signing key in controlled backup. Store publication requires a separate
explicit approval.
