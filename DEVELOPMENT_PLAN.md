# WalletSwap development plan

## Repository review

### Files and entry point

The repository initially tracked only `README.md`. Phase 1 now adds the original supplied prototype and app tooling:

| File | Current contents |
| --- | --- |
| `README.md` | Development, web preview, test/build, and Capacitor commands |
| `Mockup.html` | Byte-for-byte copy of the supplied standalone prototype |
| `index.html` | Vite app entry point, byte-for-byte copy of the supplied prototype |
| `package.json` | Vite and Capacitor dependencies and development/native scripts |
| `capacitor.config.json` | WalletSwap app name, provisional ID, and Vite output directory |
| `tests/prototype.test.js` | Built-in Node tests for the preserved prototype, its script syntax, key flows, and asset paths |
| `package-lock.json` | Reproducible npm dependency lockfile |

The supplied `Mockup.html` attachment was preserved as `Mockup.html`; `index.html` is an identical copy used by Vite as the application entry point. Both keep its complete inline CSS/JavaScript, `<div id="root">` mount point, and existing interface. `dist/` is the Vite production output and is used as Capacitor's `webDir`.

### Existing prototype and behavior

The prototype is plain browser JavaScript and HTML, with CSS embedded in the document; it does not use React, Vue, or another application framework.

- **Screens and navigation:** `render()` and `appShell()` route the hash URLs into wallet, cards, card detail, add-card, marketplace, activity, and profile screens (lines 596–667). The landing, login, and sign-up views are also present.
- **Gift-card data and actions:** `Store`, `freshData()`, and `seedDemoData()` initialize and persist wallet data (lines 450–585). `FORMS.add()`, `spend()`, `edit()`, `sell()`, and `reprice()` handle card creation, balance updates, and simulated listings (lines 1236–1350). `ACTIONS.confirm()` handles unlisting, removal, and reset (within lines 1178–1233).
- **Marketplace and activity:** `seedMarket()` creates sample listings; `ACTIONS.buy()` removes a listing, generates a card number/PIN, adds a card to the wallet, and records the simulated purchase. The corresponding views are `vMarket()` and `vActivity()` (lines 530–543, 852–906, and 1178–1233).
- **Simulated sales:** `FORMS._price()` gives a listing a randomized 25–70 second sale time. `processSales()` later removes due listings, adds proceeds after the 5% simulated fee, and logs a sale; it is called on sign-in and every four seconds (lines 1020, 1153–1175, and 1432).
- **Payment and payout screens:** `FORMS.payment()`, `payout()`, and `withdraw()` validate sample form input and keep only display labels/amounts in local state. There is no payment processor, bank connection, or real transfer in these handlers (lines 1236–1377).
- **Storage/authentication:** the prototype stores the whole application state in browser `localStorage`; an optional `window.claude.use("db")` / `window.claude.use("user")` adapter attempts cloud synchronization when that host object exists (lines 450–494). Account creation and password checks are local prototype logic, not a production authentication service.

### Ruby AI, OpenAI, framework, and dependencies

The README mentions a “Ruby AI agent,” but the repository has no Ruby source, Gemfile, agent implementation, or configuration. The mockup contains no Ruby integration. No OpenAI client, API call, endpoint, or configuration is present in the repository or mockup. The optional `window.claude` adapter is a separate host-provided database/user integration; it is not evidence of a Ruby or OpenAI implementation. No API keys should be added to the client app.

The existing interface is plain browser JavaScript with embedded CSS and uses browser APIs, including `localStorage`, hash navigation, and timers. Vite and Capacitor are now configured, with no UI framework introduced.

## Recommendation

**Phase 1 brings the supplied mockup into version control as the preserved app entry point and wraps it in Vite/Capacitor without replacing its UI or rewriting its screens.** The web preview and primary routes have been smoke-tested; native builds remain to be run on machines with the platform toolchains.

After the existing prototype is safely in the repository, package it with Capacitor as a web app first. Defer Ruby AI, OpenAI, real authentication/cloud persistence, payment processing, and real gift-card transfers until their requirements and trusted service boundaries are separately defined.

## Capacitor implementation steps

1. **Completed: preserve the existing app entry point.** Added the attached prototype as `Mockup.html` and `index.html` without changing its contents.
2. **Completed: configure web and native tooling.** Added Vite, Capacitor runtime/CLI, Android/iOS platform packages, and npm scripts. Vite builds the app into `dist/`.
3. **Completed: generate and synchronize native projects.** Added Android and iOS Capacitor project scaffolds and synchronized the built `dist/` assets into both projects. Native toolchains are not present in this Windows environment, so no native build has been claimed.
4. **Next: build and smoke-test each platform.** Open Android in Android Studio and iOS in Xcode; verify launch, safe-area layout, hash navigation, forms, local persistence, clipboard behavior, back navigation, and keyboard/viewport behavior. Android builds require Android Studio, the Android SDK, and a JDK; iOS builds require macOS and Xcode.
5. **Preserve demo-only boundaries.** Keep marketplace listings, purchases, card numbers/PINs, sales, and withdrawals simulated. Clearly label demo payment/payout data; do not collect real credentials or route funds. Do not put API keys in the web bundle or app binary.
6. **Plan production services separately.** Before implementing a Ruby service, AI integration, or cloud sync, define the service contract, authentication, data ownership, and deployment requirements. If OpenAI is later selected, call it from a trusted server-side service and keep credentials there; no such integration is implemented now.
7. **Expand regression coverage before modifying behavior.** Cover adding/editing/spending/removing cards, marketplace purchase/list/unlist/reprice, sale completion and fee calculations, activity history, and persistence. Run the same smoke checks in browser and on both native WebViews after each material change.

Phase 1 uses no paid services or payment integrations. No Android or iOS native build result is implied by adding Capacitor dependencies/configuration.

## Current scope exclusions

- No payments, bank connectivity, or real gift-card delivery/transfers.
- No new Ruby AI or OpenAI integration inferred from the README.
- No framework migration or redesign as part of Capacitor packaging.
- No API key creation, collection, or client-side storage.

## Backend phase status

The optional Supabase groundwork is documented separately in
[`BACKEND_IMPLEMENTATION_PLAN.md`](BACKEND_IMPLEMENTATION_PLAN.md). It adds
versioned schema/operations migrations, RLS, client services, guarded Edge
Function handlers, a pgTAP draft, and a user-confirmed metadata-only import
path. The existing HTML prototype and demo account remain available.

The cloud UI is wired for authentication, remote wallet/activity/market data,
reported balance changes, archival, profile names, listing management, and
simulation-only purchase records. It intentionally does not enable real
payment collection, gift-card transfers, settlement, bank details, or payouts.
No Supabase project is configured or deployed, and database/Edge Function
behavior is not yet verified; consult the backend setup and test report before
attempting local or hosted deployment.
