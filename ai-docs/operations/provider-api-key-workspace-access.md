# Customer-Owned Provider API Keys

Workspace owners and admins can connect their own MiMo Token Plan or OpenRouter API key in the dashboard. No operator grant is needed. The provider-key form stores the key encrypted for the workspace and applies it to the selected repositories as a GitHub Actions secret. Reads return connection status and repository results, never the key. An existing saved key can be reused for another apply without entering it again.

The dashboard API requires a signed-in workspace owner or admin and an active workspace entitlement. Repository targets must belong to the same workspace, have an active GitHub App installation, and be available to the App. Applying or rotating a key retains the existing batch fencing and reconciliation behavior. A customer can also set `MIMO_TOKEN_PLAN_API_KEY` directly in a repository's GitHub Actions secrets. Review configuration and workflow provisioning check the repository secret's readiness; they do not require a key saved in ReviewRouter.

`ProviderApiKeyWorkspaceGrant` and `scripts/provider-api-key-workspace-access.ts` remain as historical operator artifacts. Their grant state no longer authorizes or blocks customer-owned MiMo or OpenRouter keys, review configuration, or workflow provisioning. There is no shared MiMo key pool. Do not use the grant command as a customer onboarding step.

Codex hosted pool authorization and credentials are separate and retain their own access controls.
