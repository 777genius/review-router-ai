# AI providers and connection methods

ReviewRouter offers direct CI credentials for selected reviewer workflows and
managed native accounts via Sub2API Standalone → Account Gateway → ReviewRouter.
**This matrix lists implemented managed-native methods, not a promise they are
enabled in every hosted or self-hosted deployment.** Check the Add account
catalog for the currently mounted and permitted methods.

## Managed-native connection methods

| Provider / product | Connection methods | Qualification | Conditions and limits |
| --- | --- | --- | --- |
| Anthropic / Claude | API key; browser OAuth; session-key-assisted OAuth; setup token by code or cookie | Native E2E | Subscription flows require the corresponding native capability and authorization. |
| Claude via AWS Bedrock | AWS SigV4 keys, including temporary session credentials; Bedrock API key | Native E2E | Configured AWS region and credential policy required. |
| Claude via Vertex AI | Google service-account JSON | Native E2E | Configured project, region and permitted target required. |
| Gemini / Google | API key; Google One OAuth; Code Assist OAuth; AI Studio custom-client OAuth | Native E2E | AI Studio OAuth requires an operator-configured client. |
| Gemini via Vertex AI | Google service-account JSON; Vertex API key (project/region or express mode) | Native E2E | Express support is conditional on the native profile. |
| OpenAI API | API key | Native E2E | Direct API billing; not Codex subscription authentication. |
| OpenAI Codex | Browser or device OAuth; refresh token; mobile refresh token; auth.json; session import; Agent Identity; PAT | Native E2E | Imported credentials have distinct refresh and expiry guarantees. |
| Grok | API key; browser OAuth; refresh-token import; SSO import | Native E2E | Subscription and SSO methods require their native enrollment configuration. |
| Antigravity | Browser OAuth; refresh-token import; API key for approved target | Native E2E | Operator must allowlist the target; no arbitrary URLs. |
| Kimi | PAYG API key; Kimi Code plan API key | Native E2E | Select the matching product and credential. |
| GLM | PAYG API key; Coding Plan API key | Native E2E | Organization/project inputs may apply. |
| DeepSeek | API key | Native E2E | Only when the native profile is mounted. |
| MiniMax | PAYG API key; M Plan API key | Native E2E | Separate products and credential policies. |
| OpenCode Go / Zen | Go API key; Zen API key | Native E2E | Distinct native product profiles. |
| Command Code | API key | Native E2E | Only when the native profile is mounted. |
| Cline | API key | Native E2E | Only when the native profile is mounted. |
| OpenRouter | API key | Native E2E | Available models depend on the account and catalog. |
| NVIDIA Build | API key | Native E2E | Available models depend on the account and catalog. |
| MiMo Token Plan | Token Plan API key | Separate path | Existing ReviewRouter integration; outside the 53 native scenarios. |
| TypeSafe SystemOne | API key declaration only; no qualified generative review | Unsupported for review | Excluded: no required generative review, streaming and tool-continuation contract. |

## What is verified

The [fixed native G0 inventory](https://github.com/agent-teams-ai/sub2api-standalone/blob/9fc45a440eefcad815e16775200407b839419313/backend/internal/gatewaybootstrap/testdata/native_connection_g0_rows.json)
has **53 profile/method/credential variants**, across **30 profiles** and **17 method IDs**.
The [joined E2E run](https://github.com/agent-teams-ai/account-gateway/actions/runs/45671137815)
passed **52/52 required scenarios** with controlled provider endpoints, including
enrollment, streaming review, tool continuation, reconnect and credential erasure.
TypeSafe is retained as an **unsupported** observation with no generative review
dispatch; it did not pass. MiMo Token Plan has a separate, existing
ReviewRouter route and was not included in those 53 native cases.

**Source qualification is not live-provider qualification.** The
[deployment record](../ai-docs/deployments/2026-11-21-native-provider-parity.md)
reported ten configured native profiles on 27 November 2026 with successful
catalog/readiness checks but without completed live account/provider review
acceptance. Availability and supported credentials vary by tenant, installed
workflow, permitted targets and provider configuration.

A managed-native method is **not automatically** a direct GitHub Actions
secret, rotating OAuth or hosted-pool mode. The [getting-started guide](https://reviewrouter.org/getting-started)
covers those separate, narrower paths.

## Maintenance boundary

Sub2API owns provider HTTP, authentication, refresh, adapter behavior and
method descriptors. Account Gateway provides a versioned account lifecycle
contract; ReviewRouter provides setup UI, permissions and review policy.
Additional methods compatible with existing interaction/execution primitives
can be introduced and qualified in Native without provider-specific
ReviewRouter changes. New primitives, protocols and later upstream providers
need separate compatible work and E2E. See the
[native parity plan](https://github.com/agent-teams-ai/sub2api-standalone/blob/main/docs/native-provider-parity-plan.md).
