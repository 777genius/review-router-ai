-- Reconcile instances that already applied the original119 provider allowlist.
-- Preserve immutable configuration settings and every historical migration entry.
BEGIN;

ALTER TABLE "ReviewConfigurationVersion"
  DROP CONSTRAINT "ReviewConfigurationVersion_auth_kind",
  ADD CONSTRAINT "ReviewConfigurationVersion_auth_kind" CHECK (
    ("providerKind" = 'codex' AND "providerAuthMode" IN (
      'codex_subscription_oauth', 'codex_subscription_oauth_rotating',
      'codex_subscription_oauth_hosted_pool', 'codex_openai_api_key', 'codex_account_gateway'))
    OR ("providerKind" = 'codex-mimo' AND "providerAuthMode" = 'mimo_token_plan_api_key')
    OR ("providerKind" = 'claude' AND "providerAuthMode" = 'claude_code_oauth')
    OR ("providerKind" = 'openrouter' AND "providerAuthMode" = 'openrouter_api_key')
  );

ALTER TABLE "ReviewConfigurationVersionProvider"
  DROP CONSTRAINT "ReviewConfigurationVersionProvider_auth_kind",
  ADD CONSTRAINT "ReviewConfigurationVersionProvider_auth_kind" CHECK (
    ("providerKind" = 'codex' AND "providerAuthMode" IN (
      'codex_subscription_oauth', 'codex_subscription_oauth_rotating',
      'codex_subscription_oauth_hosted_pool', 'codex_openai_api_key', 'codex_account_gateway'))
    OR ("providerKind" = 'codex-mimo' AND "providerAuthMode" = 'mimo_token_plan_api_key')
    OR ("providerKind" = 'claude' AND "providerAuthMode" = 'claude_code_oauth')
    OR ("providerKind" = 'openrouter' AND "providerAuthMode" = 'openrouter_api_key')
  );

COMMIT;
