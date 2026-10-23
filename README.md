# WalletSwap

WalletSwap's existing standalone HTML prototype is the web app and Capacitor entry point. It retains the original wallet, card management, simulated marketplace, activity, profile, and demo transaction flows.

## Development

Requirements: Node.js 20.19+ (or 22.12+) and npm.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`) to preview the app. The demo wallet is available from the landing page using **Try the demo**.

## Build and test

```sh
npm test
npm run build
npm run preview
```

Vite outputs the production web app to `dist/`; Capacitor uses that directory for native WebViews. The provisional native app ID is `com.walletswap.app`.

## Capacitor platforms

After installing the platform prerequisites, generate/synchronize native projects:

```sh
npm run cap:add:android
npm run cap:sync:android
npm run cap:open:android
```

```sh
npm run cap:add:ios
npm run cap:sync:ios
npm run cap:open:ios
```

Android builds need Android Studio and its SDK/JDK. iOS builds and testing require macOS and Xcode. The HTML prototype only simulates payments, listings, sales, and payouts; it does not integrate a payment provider or perform real gift-card transfers.

## Gift-card capture

The Add Card screen supports barcode/QR scanning and photo capture on native devices, plus manual entry everywhere. On Android, the first scan may download Google's barcode-scanner module. Photo OCR runs locally on native devices and only suggests a retailer, explicitly printed face value, and expiry; the user must enter the retailer-reported remaining balance and confirm all details. Browser users can take/select a photo but must enter details manually; browser barcode scanning and OCR are unavailable.

Scanned values are displayed only in masked form and are never sent to an AI service. Captured photos are temporary and removed when discarded or after adding the card. Native card numbers and PINs use device secure storage; browser persistence retains only masked identifiers.

**iOS integration is not ready to build yet:** the existing generated iOS project uses Swift Package Manager, while both selected ML Kit plugins currently require CocoaPods. Before enabling native iOS scanning/OCR, migrate the iOS project to CocoaPods on macOS, then run `npm run cap:sync:ios` and test camera permissions and capture on a physical iPhone. Android/iOS native builds and physical-device behavior have not been verified from this Windows development environment.

## Optional Supabase backend and Ruby

The repository includes Supabase Auth, wallet, marketplace, notification,
and Ruby services. The existing project URL and publishable key are configured
in ignored `.env.local`; the public Auth settings endpoint is reachable, but
the current audit did not repeat an authenticated end-to-end check. Earlier
project work documented a signed-in Demo Mode test. Without Supabase
environment variables, use the local demo account; non-demo local
authentication is disabled. See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for local setup and the
approval-gated steps for the existing hosted project. The CLI is linked, but
the latest migration status reports base migrations `001` and `002` applied;
activity/notification migration `003` and Ruby usage-controls migration `004`
remain local and unapplied. Authenticated end-to-end behavior is not
established by migration metadata alone.
Never put a service-role or OpenAI key in browser environment variables or the
app bundle.

Cloud mode stores card metadata and masked identifiers only; complete card
numbers/PINs remain in native secure storage. Balances and marketplace listings
are user-reported/previews. Payments, transfers, settlement, payouts, retailer
verification, push delivery, and wallet-pass issuance are not enabled. User-scoped
in-app alerts, foreground Realtime updates, and native local notifications are
implemented; push delivery still needs an approved FCM/APNs backend.
The Ruby chat UI and authenticated Responses API Edge Function are implemented
locally. The current project reports `ruby-chat` active with JWT verification;
the current local fail-closed/live-only source and usage-controls migration are
not deployed. Never add OpenAI credentials to the browser or native app.
`account-delete` remains undeployed.
See [RUBY_AGENT_DOCUMENTATION.md](RUBY_AGENT_DOCUMENTATION.md),
[BACKEND_TEST_REPORT.md](BACKEND_TEST_REPORT.md), [QA_REPORT.md](QA_REPORT.md),
[BACKEND_IMPLEMENTATION_PLAN.md](BACKEND_IMPLEMENTATION_PLAN.md),
[DATABASE_SCHEMA.md](DATABASE_SCHEMA.md), and
[SECURITY_REVIEW.md](SECURITY_REVIEW.md),
[PHASE_2B_QA_REPORT.md](PHASE_2B_QA_REPORT.md),
[PROJECT_AUDIT.md](PROJECT_AUDIT.md), [ANDROID_RELEASE.md](ANDROID_RELEASE.md),
and [WALLET_PASS_READINESS.md](WALLET_PASS_READINESS.md) before deployment or
release. GitHub Actions now defines web test/build and Android debug APK jobs;
no CI run or APK is verified yet.
