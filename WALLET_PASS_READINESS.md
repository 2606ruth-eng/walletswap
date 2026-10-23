# Apple Wallet and Google Wallet readiness

## Current capability

WalletSwap can ask the backend whether an owned card is eligible for a pass.
No issuer is approved or connected, and the result remains unsupported until a
real issuer integration exists. The current app does not create, sign, upload,
or issue an Apple Wallet pass or Google Wallet object. Do not represent a
WalletSwap gift card as issuer-authorized or claim that adding it to a wallet
verifies its balance.

## Required before implementation

1. Obtain written authorization and the supported API/pass contract from each
   participating gift-card issuer. Public listings or retailer names alone do
   not authorize pass creation or balance access.
2. Confirm the issuer's permitted card types, required identifiers, lifecycle,
   revocation, update, and support responsibilities. Keep redemption codes,
   PINs, and full credentials out of the pass unless that issuer explicitly
   requires them and a separate security review approves that design.
3. For Apple Wallet, obtain the required Apple developer account access,
   Pass Type ID, certificate/signing process, and device distribution plan.
   Keep certificates and private keys in a protected signing environment.
4. For Google Wallet, obtain the required Google Wallet issuer account,
   approved issuer access, object/class design, signing credentials, and
   service-account authorization. Keep service credentials outside the app.
5. Define server-side ownership authorization, minimum data retention,
   authenticated pass issuance, updates/revocation, audit records, and
   user-visible consent.
6. Add issuer-specific sandbox and physical-device tests. Keep unsupported
   issuers disabled and retain the existing manual wallet card as the fallback.

## Cost and release gate

No pass vendor or paid service is activated by the current repository. Confirm
any issuer/platform fees and operational costs before implementation; the
integration must fit the user's $100/month operating budget. Do not deploy,
sign, or publish a pass integration without issuer authorization and explicit
approval.
