# Android build and release readiness

## Current state

The Android Capacitor project uses application ID `com.walletswap.app` and
supports a debug build from the generated Gradle wrapper. The project has not
been compiled in this Windows environment because Java and the Android SDK are
unavailable. The new `.github/workflows/ci.yml` workflow runs web tests/build
and packages an unsigned-for-release **debug** APK as a CI artifact. No APK
exists until that workflow completes successfully.

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
debug signing key for distribution.

## Store release gate

Before creating a Play Store release, confirm the final application ID and
versioning, privacy disclosures, camera/notification permission explanations,
data safety declaration, screenshots, and store listing. Configure a private
release signing key in the build environment's protected secrets; never commit
keystores, passwords, signing properties, or service-account credentials.
Test a signed candidate on physical devices, inspect the artifact, and retain
the signing key in controlled backup. Store publication requires a separate
explicit approval.
