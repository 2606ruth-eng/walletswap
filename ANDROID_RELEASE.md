# Android build and release readiness

## Current state

The Android Capacitor project uses application ID `com.walletswap.app`. The
Windows host lacks Java and the Android SDK. The previous CI run produced a
debug APK from commit `4396f16a2f26db980f6660190674e41592b2328f` before
Supabase variables were wired into the Android job; it is not the corrected
APK and should not be reused for cloud-login testing.

The frontend expects `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`. The repository originally had the misspelled
`VITE_SUPABASE_PUBLISHED_KEY`; I copied its existing value into the correctly
named repository variable without displaying the value. The Android workflow
reads the canonical key first and retains the typo as a compatibility fallback.
It validates both values without printing them, builds with those Vite
variables before Capacitor sync, verifies the compiled app contains Supabase
initialization and Ruby UI, scans for server-secret patterns, and fails instead
of creating a cloud-disabled APK.

The demo-account FAB was previously hidden because it was conditioned on
`!a.demo && supabaseConfigured`; Ruby's screen already had a demo explanation,
but users had no visible way to reach it. The FAB is now visible for demo
accounts and the login page explains the distinction. Ruby Live remains
available only to real authenticated accounts.

The Android build for PR commit
`4396f16a2f26db980f6660190674e41592b2328f` used the former workflow, which did
not pass either Supabase variable into Vite. That explains the observed
cloud-login warning for real accounts. The same commit hides the Ruby FAB for
demo users, so it also explains why Ruby was not discoverable there. The
installed device itself does not report its APK's embedded source SHA, so
`4396f16` is the prior CI artifact's source commit, not independent proof of
the installed APK's provenance.

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

The corrected artifact name is
`walletswap-android-configured-debug`. After the updated CI run completes,
download it from the Actions run's **Artifacts** section. It is a test artifact,
not a store-ready release. Do not use a debug signing key for distribution.
Physical-device installation and feature testing remain unverified until the
new artifact is installed and exercised.

## Store release gate

Before creating a Play Store release, confirm the final application ID and
versioning, privacy disclosures, camera/notification permission explanations,
data safety declaration, screenshots, and store listing. Configure a private
release signing key in the build environment's protected secrets; never commit
keystores, passwords, signing properties, or service-account credentials.
Test a signed candidate on physical devices, inspect the artifact, and retain
the signing key in controlled backup. Store publication requires a separate
explicit approval.
