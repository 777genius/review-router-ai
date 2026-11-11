-- Add one direct Anthropic API-key credential mode for the existing Claude Code provider.
-- No credential storage changes, no historical-row rewrite and no OAuth migration.
BEGIN;
ALTER TABLE "WorkspaceProviderProfile"
  DROP CONSTRAINT "WorkspaceProviderProfile_auth_mode";
ALTER TABLE "WorkspaceProviderProfile"
  ADD CONSTRAINT "WorkspaceProviderProfile_auth_mode" CHECK (
    ("credentialKind" = 'gateway_binding' AND "authMode" = 'codex_account_gateway')
    OR ("credentialKind" = 'managed_api_key'
      AND "authMode" IN ('mimo_token_plan_api_key', 'openrouter_api_key', 'claude_code_api_key'))
    OR ("credentialKind" = 'hosted_pool'
      AND "authMode" = 'codex_subscription_oauth_hosted_pool')
    OR ("credentialKind" = 'repository_rotating'
      AND "authMode" = 'codex_subscription_oauth_rotating')
    OR ("credentialKind" = 'user_ci_secret'
      AND "authMode" IN (
        'mimo_token_plan_api_key', 'claude_code_oauth', 'claude_code_api_key',
        'openrouter_api_key', 'kimi_code_api_key'
      ))
  );
COMMIT;
