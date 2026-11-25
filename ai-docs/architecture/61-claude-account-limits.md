# Claude account limits

Claude quota belongs to the provider account, including activity outside ReviewRouter. It is separate from ReviewRouter usage analytics and API-key billing.

The Claude profile is `anthropic-claude-oauth-messages-v1`, with a fixed Anthropic origin and the source-qualified `claude-sonnet-4-6` model. Gateway enrollment is explicitly configured; the RR allowlist is enabled only by `REVIEW_ROUTER_ACCOUNT_GATEWAY_CLAUDE_OAUTH_PROFILE_ID=anthropic-claude-oauth-messages-v1`. A catalog entry alone does not qualify an account or activate production support.

Claude uses browser PKCE. The official authorization page returns a sensitive `code#state` value. Submit it once through the authenticated completion form; it is not an API key and must not enter logs, operation readback, browser URLs or query caches. Device-code sign-in remains specific to providers that implement it.

The native source binds the account and organization returned by the trusted OAuth exchange to its encrypted credential custody and immutable physical generation. Refresh retains that principal; reconnect and cleanup fence old observations. Existing unqualified admin `extra`, local token counts and credentials are not quota evidence.

Ordinary authorized Claude responses can publish the allowlisted Anthropic 5h, 7d and Fable weekly headers with their actual receipt time. The canonical contract also distinguishes a Sonnet weekly observation when a source supplies one; an absent model window is omitted. The source converts utilization fractions to percentages and keeps malformed or absent fields unknown. A reset passing does not imply a reported zero.

Accounts reads only the saved `account-limits/v1` snapshot through native, Gateway and the pinned SDK. Reading the page or reloading its saved limits does not invoke inference, OAuth refresh, quota refresh or account repair. Exact owner, profile, authorization epoch and generation checks apply before observations reach the safe browser projection. Native account IDs and principal identifiers remain server-side.

The compact view shows remaining percentage, a matching bar and reset countdown. Details preserves reported use and exact observation/reset times. Shared accounts expose quota only to their owner. Unsupported, missing and unavailable observations stay distinct.

Delivery evidence and the exact source/archive hashes belong in `vendor/account-gateway/account-limits-provenance.json`. Controlled local provider fixtures and disposable PostgreSQL/browser tests establish integration behavior; they do not establish a live Claude session or production activation. Deployment and migration ordering follow the normal release process.
