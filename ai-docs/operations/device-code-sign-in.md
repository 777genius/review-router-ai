# Device-code account sign-in

OpenAI account connections offer Device code first and browser callback as a
fallback. Both methods use the existing account enrollment operation, owner
checks, native token validation and promotion. Creating a personal connection,
granting organization access and selecting a model remain separate actions.

Before device sign-in, the UI links to
[ChatGPT Settings / Security](https://chatgpt.com/settings/security) and tells
the user to enable device code login at the bottom of the page. Managed
workspaces can require administrator permission, as described in the
[official authentication guide](https://learn.chatgpt.com/docs/auth#login-on-headless-devices).

## Contract and custody

- Omitted method retains browser behavior for existing clients.
- Device method is bound to the original immutable operation identity.
- A fresh Begin returns only the user code, verification URL, expiry and poll
  interval. The native device identifier, verifier and tokens stay native.
- The original page polls an authenticated POST for its operation. Closing the
  dialog preserves the current handoff in memory; reload recovers safe status
  without reconstructing a lost one-off handoff.
- Expired codes disappear. A lost acknowledgement is reconciled under the
  original operation, without a second Begin or token exchange.
- A transient list outage retains visibly stale rows with actions disabled.
  Authorization denial clears the rows. Terminal status checks can explicitly
  retry failed account reads.

## Ordered rollout

1. Apply native migration `251_gateway_oauth_device_connect.sql` and deploy its
   compatible native implementation.
2. Deploy the paired Account Gateway implementation with
   `POST /v1/accounts/oauth/poll` and the device handoff contract.
3. Apply ReviewRouter migration `000140_personal_oauth_method` before deploying
   the corresponding server adapter and private vendored SDK.
4. Deploy the dependent UI change, which selects Device code by default.

The exact native and SDK source commits and private archive hash are recorded
in `vendor/account-gateway/device-sign-in-provenance.json`. Existing browser
operations and their intent hashes are preserved. No public SDK publication is
needed for this batch. Production activation remains subject to the Gateway
repository's owner approval requirement.

## Validation boundary

Controlled tests cover native HTTP/Go/PostgreSQL fencing, concurrent polling,
one-use exchange, reconnect, expiry, owner revocation, the SDK wire contract,
SaaS ownership and persistence, and the real UI components with a fake adapter.
They do not claim a live OpenAI authorization or production activation.

On 2026-10-22, a browser comparison with the same Codex client and authorize
parameters rejected `https://reviewrouter.org/auth/callback` with
`invalid_authorize_request`, while the localhost callback reached the account
picker. No account was selected. A custom ReviewRouter callback is therefore
not enabled for this integration.
