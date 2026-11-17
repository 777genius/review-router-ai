# NVIDIA live model list, 512-model catalogue bound and typed model names: deployment

- Task ID: `2026-11-17-nvidia-live-model-catalog`
- Goal: an NVIDIA Build account offers every model of NVIDIA's public list that can review code (anchor first), the coding plan catalogues are no longer cut at 8 models, and a Gateway model can be typed into the model field with a clear message when it is malformed or not in the account's list.
- Affected targets: native (`agent-teams-ai/sub2api`), Account Gateway service and SDK (`agent-teams-ai/account-gateway`), ReviewRouter Web and API (vendored SDK, conversation source stamp).
- Implementation: native PR (link added on merge), Gateway PR (link added on merge), this ReviewRouter PR. Design: [68](../architecture/68-nvidia-live-model-catalog.md).
- Dependencies: the coding plan catalogues of [64](../architecture/64-gateway-native-ownership-and-model-catalog.md) and [65](../architecture/65-live-coding-plan-model-catalog.md) (native #99/#100, Gateway #109/#110, ReviewRouter #879). They have no deployment record; on 2026-11-17 the registry shows production on Gateway 108 and native 98, so they look undeployed. Verify before rollout.
- Last updated: 2026-11-17.

## Environment status

| Target     | Status    | Actual version | Evidence                                     |
| ---------- | --------- | -------------- | -------------------------------------------- |
| Staging    | `pending` | Not verified   | Ordered rollout below                        |
| Production | `pending` | Not verified   | No deployment authorized by the source merge |

## Applicability and rollout

No migration, configuration or feature flag. The order matters because the change widens a contract bound: native with this change must go last, after every consumer accepts the longer snapshot. Native first would make the old Gateway (NVIDIA `length(1)`, coding plans `max(8)`) answer `unknown`, and NVIDIA would lose every model, including the anchor.

1. Read the actual native, Gateway and ReviewRouter versions of the environment.
2. If 64/65 are not deployed there: deploy native at the merge commit of native #100 (without this change), then continue. If they are deployed, skip this step.
3. Deploy the Gateway with this change (SDK contract 512). Check: Kimi, GLM and MiniMax accounts still read their catalogue, the NVIDIA account still reads its one anchor model.
4. Deploy ReviewRouter Web and API with the new SDK, together with the conversation requalification that the changed `conversation-source-stamp` requires (as for 64/65).
5. Deploy native with this change. Check on an NVIDIA account: Providers > model list shows the anchor first and about 18 NVIDIA models, no embed, guard, safety, clip, detector or translate models; native logs a `gateway_native_live_model_catalog` line with `profile` `nvidia-build-chat-apikey-v1`.
6. Record the actual versions, timestamps and evidence separately per environment.

## Verification and completion

- NVIDIA model field: typing `gpt-oss` filters the list; a malformed name shows the shape rule; a well-formed unlisted name says the account's list does not include it and cannot be saved.
- A review with a non-anchor NVIDIA model is admitted; one with an unlisted model is refused before the provider.
- No new `unknown` catalogue answers for Kimi, GLM, MiniMax or NVIDIA after each step.

## Retry and rollback

Every step is an ordinary service deployment and can be repeated. Roll back in reverse: native first, then Gateway, then ReviewRouter. After native is rolled back, saved NVIDIA models other than the anchor and coding plan models beyond the static ones are refused at checkout (`gateway_model_settings_unavailable`) until they are changed. Record a rollback as `rolled_back` with the previous versions.

## Execution log

| Time         | Target             | Actual version | Result                                   |
| ------------ | ------------------ | -------------- | ---------------------------------------- |
| Not executed | Staging/Production | Not verified   | Pending; no environment mutation claimed |
