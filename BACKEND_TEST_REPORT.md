# Backend implementation test report

## Browser-side checks

`npm test` runs the built-in Node test runner. The current suite covers:

- Supabase publishable-key configuration validation and rejection of server
  secrets or insecure remote URLs.
- Currency conversion and validation of money values.
- Card payload field allow-listing and masked remote card mapping.
- Legacy import filtering for demo accounts and credential removal.
- Prototype, camera capture, app identity, Ruby Responses API payload parsing,
  and Ruby authenticated/persistent conversation regression checks.

`npm run build` runs the Vite production build and bundles the browser client.

Latest local run:

- `npm test`: **34 passed, 0 failed**.
- `npm run build`: **passed** (Vite production bundle generated).
- Browser preview: the configured project's Auth settings endpoint returned
  HTTP 200; email auth is configured and signups are not disabled. The local
  login page rendered without the missing-configuration warning.
- `npm run cap:sync`: completed for Android and iOS; Capacitor warned that the
  ML Kit scanning/OCR plugins do not support the generated iOS SPM integration.
  The native project was not compiled.
- Android manifest and iOS Info.plist parse as well-formed XML, including the
  `walletswap://auth/callback` scheme registration.

## Database and native checks not completed

- `npx supabase db lint` was attempted but could not connect to local Postgres
  at `127.0.0.1:54322`; Docker is not installed/available here.
- `npx supabase db reset` and `npx supabase test db` were not run because
  Docker/local Postgres is unavailable.
- The SQL pgTAP test draft has not been executed. SQL correctness and RLS
  behavior therefore remain unverified.
- Edge Functions have not been type-checked (Deno is unavailable) or deployed.
- The authenticated CLI was linked to the existing project. Before applying,
  the migration list and dry run showed both local migrations pending.
- After explicit owner approval, both migrations were applied successfully.
  Initial attempts revealed an invalid column-level `GRANT` and a composite
  `SELECT INTO`; both statements were corrected before the successful push.
- Read-only remote metadata queries verified 17 public base tables with RLS
  enabled, 16 with policies, and the Ruby rate-limit table without authenticated
  table grants. Key wallet, marketplace, import, and Ruby rate-limit RPCs
  exist with authenticated execution grants.
- The secret-name check reports that `OPENAI_API_KEY` is absent. No secret
  values were retrieved or displayed; no Edge Function was deployed.
- No authenticated test user was created or used. Authenticated wallet
  persistence, Ruby tool execution, cross-account isolation, and hosted
  notifications remain untested.
- Android/iOS native builds and physical-device Auth/camera tests were not run.

Passing frontend tests do not imply that the remote database, Edge Functions,
or native apps are production-ready. The pgTAP suite includes wallet ownership
and Ruby conversation isolation checks, but still needs execution against a
Postgres instance.
