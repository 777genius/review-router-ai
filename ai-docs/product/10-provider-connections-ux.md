# Providers and connections UX

Scope: provider setup, connection management, and dynamic OpenRouter account
models, updated on 2026-10-28.
This updates the navigation and presentation described in the
[repository onboarding plan](../plans/2026-10-26-repository-provider-onboarding.md).
Credential custody, workspace authorization, repository readiness, and the
release process retain their existing owners. The coordinated Gateway/native
change extends model admission through the existing account-model contract.

## User-facing structure

The workspace navigation has one **Providers** destination with two views,
**Review providers** and **Connections**. **Review settings** remains a separate
destination for review behavior. All three reuse the existing implementations:

| View             | User task                                                                          | Existing owner                            |
| ---------------- | ---------------------------------------------------------------------------------- | ----------------------------------------- |
| Review providers | Save a connection and model choice, edit it, and choose the workspace default      | Provider profiles and selections          |
| Connections      | Connect, reconnect, inspect limits, manage access, disable, or remove a connection | Account management and workspace bindings |
| Review settings  | Set review behavior and quality gates                                              | Workspace review configuration            |

The previous `/dashboard/setup` URL remains the Connections view. Existing
links and validated setup continuation parameters retain their workspace and
repository targets. Both provider views highlight the same navigation item.
The Review settings page shows the current default and links to Providers;
it does not contain a second editor for that default.

Repositories remain the place to finish their workflow and credential setup.
Saving a profile, connecting an account, or granting access is not a claim that
a repository is ready to review.

## Provider first, storage second

The provider setup dialog names providers independently of their credential
storage. **ReviewRouter** is the first and default storage choice.
**GitHub Secrets** is the second choice. A deployment or target restriction
disables the unavailable choice with a reason; it does not silently select
another custody mode.

The dialog reuses the only eligible connected account automatically after the
complete inventory has loaded successfully. With multiple eligible connections
or more pages still to load, the user chooses which one to use. It never
creates a connection or grants access just because the dialog opened or a
provider was selected.

Connection creation uses the existing provider-first form. The selected
profile determines whether the user enters a key or completes browser/device
sign-in. The old API-key/OAuth entry menu is unnecessary. The credential and
OAuth forms, reconnect paths, operation readback, and recovery behavior remain
owned by their existing components.

The **Connect OpenRouter** continuation opens the existing API-key form with
OpenRouter selected, rather than requiring another Add connection action.
Restored pending operations take priority over opening a new form. For an
authorized workspace owner, the current workspace is preselected when that
provider is available there; otherwise the form keeps the personal ownership
path and its explicit access controls. A connection that needs a workspace
binding offers **Make available and continue**, using the existing binding
mutation before returning to the original provider setup. An already available
connection offers **Continue provider setup**. Opening a page never shares a
personal account or submits a credential.

For GitHub Secrets, the existing managed-key capability is visible as
**Install for me**, alongside **Add on GitHub myself**. Automatic delivery
reuses the encrypted managed key and the existing batch installation endpoint.
The form explains that a copy stays encrypted in ReviewRouter while the key is
installed into each selected repository. Installation finishes before provider
assignment. Partial delivery displays per-repository results and leaves the
selection unchanged; retry reuses the saved key instead of requiring another
paste. The submitted plaintext is cleared from the form immediately.

Workspace defaults have no repository targets. Their GitHub Secrets setup links
to the existing repository selection and Configure providers action with the
provider/storage intent retained. It does not report a key as installed merely
because a workspace default was saved. Manual delivery shows the existing exact
secret-name guidance and availability checks during repository setup.

Credential wording follows the actual contract:

- API providers use an API key.
- Codex on ReviewRouter uses its existing OAuth account connection.
- Codex in GitHub Secrets uses the repository-scoped rotating session flow and
  `REVIEWROUTER_CODEX_AUTH_JSON`. It cannot be a workspace default and is not
  offered as a reusable API key.
- Claude Code on ReviewRouter uses the existing subscription OAuth connection.
  GitHub Secrets uses the existing `CLAUDE_CODE_OAUTH_TOKEN` setup flow.
- Existing qualified coding-plan and other connected-account paths remain
  available. A smaller presentation registry must not remove a working account
  type or imply support for a new authentication contract.

## Ownership and workspace access

The Connections views answer different questions:

- **For this workspace:** which connections are permitted for use here,
  including connections owned by other people or the organization.
- **All &lt;login&gt; connections:** which connections the authenticated viewer owns,
  including connections that have not been shared with this workspace. The login
  and avatar come from the existing viewer loader and `GitHubAccountAvatar`;
  neither is inferred from the workspace owner or hardcoded.

These sets can overlap. They are views of the existing ownership and access
rules, not two kinds of credential. The explanation appears next to the scope
selector. The personal management panel is mounted once; choosing an existing
connection switches to that view instead of embedding another full panel in
the add dialog.

Granting workspace access remains explicit. Permission to consume a shared
connection does not grant permission to rename, reconnect, disable, or delete
its personal source. Removing a connection from a workspace is distinct from
deleting the owned connection. Moving UI components does not merge their
authorization contexts or query-cache identities.

## One model catalog policy, separate execution admission

`review-providers` owns public model normalization, suitability, FREE labels,
ordering, cache state, and fallback provenance. OpenRouter metadata comes from
its public model endpoint without a key or agent execution. The primary cache
TTL remains 30 minutes. Cached and built-in fallback results are described as
such; a failed refresh does not become a fresh-catalog success.

Both storage modes reuse the public presentation. The connected account's
qualified profile still decides which models and review settings can be used.
Public visibility is not account access. The server now projects the qualified
connection capabilities for existing API-key and OAuth profiles as well as
coding-plan profiles, fixing missing model settings in the ReviewRouter flow.
Provider identity, protocol, authentication method, model membership, and
deployment availability are checked at that projection boundary.

OpenRouter and Codex now use the same account-scoped discovery contract.
The SDK owns the exact profile/protocol/authentication-to-source mapping;
consumers do not maintain their own dynamic-provider lists. Native reads the
fixed public OpenRouter endpoint without a key and projects text models with
confirmed tool support. Reasoning controls come from explicit
`reasoning.supported_efforts` and `reasoning.default_effort` metadata when their
values fit the qualified wire contract. A `supported_parameters` flag alone
cannot invent those levels. Missing or invalid metadata leaves that control
unavailable, while confirmed controls remain usable. The source-specific
contract accepts up to 2,048
OpenRouter rows while preserving Codex's existing 128-row bound. Dedicated
catalog clients opt into a bounded 2 MiB response; unrelated clients retain
their smaller defaults.

The configured enrollment model remains an immutable identity anchor, not a
model allowlist. A newly selected model must appear in a fresh native snapshot.
Gateway and native both check membership, and native checks it again at the
credential dispatch boundary. Reads retain owner, binding, authorization epoch,
physical generation, and credential revision fences around asynchronous work.
Empty, unknown, unsupported, malformed, expired, or wrong-source observations do
not authorize the anchor or a new model. Only an explicit unavailable result
can retain the already qualified enrollment anchor under its conservative
fallback rules.

RR projects the selected model's confirmed settings into the existing runtime
checkout contract. It releases no complete account catalog, credential, or
private principal identity to the runner. OpenRouter routing IDs can be used
through Gateway when admitted by the live source; the direct GitHub Secrets
transport retains its separately qualified routing policy.

The last recorded `workflow-v1` observation at 2026-10-29 01:27 UTC resolved to
Action 1.0.219
[`298e7fca999edaee09b59d438a5694ed8961d394`](https://github.com/777genius/review-router/tree/298e7fca999edaee09b59d438a5694ed8961d394),
as recorded in the
[catalog deployment record](../deployments/2026-10-28-model-catalog.md#modern-review-passed-lifecycle-timestamp-blocker-2026-10-29-0127-utc).
That runtime already consumes the selected model ID and nullable confirmed reasoning settings
through its existing managed model descriptor. Source inspection found no need
for a fourth repository change for this contract. It does not establish a live
provider run or production activation.

The source and SDK upgrade must be deployed together with the compatible
Gateway/native builds. Qualified account discovery is always active in API and
web. Source changes and local qualification are not a claim that production
has been upgraded. Exact archive/source identity and observed checks belong in
the [SDK provenance](../../vendor/account-gateway/README.md).

As part of the coordinated upgrade, enable the compatible catalog and reopen any
existing OpenRouter selection only if a saved control is no longer qualified by
the refreshed snapshot. Values still confirmed by the model metadata remain
valid. For an unavailable reasoning or fast control, use provider defaults
before resuming reviews. For the current workspace default, **Review settings**
opens the existing selection editor directly: choose **Account default** for an
unavailable effort and turn off unavailable fast mode. The default remains
assigned to the same profile. A null capability means that
Gateway does not offer that control for this model, not proof that the provider
itself cannot reason or offer a faster tier. Existing explicit values are not
silently ignored during execution.

## Engineering boundaries

| Responsibility                                           | Authoritative implementation                        |
| -------------------------------------------------------- | --------------------------------------------------- |
| Provider identity and available setup routes             | Provider setup registry and authorized server view  |
| Public model metadata, sorting, FREE and fallback policy | `features-review-providers`                         |
| Account model settings and admission                     | Gateway capabilities and existing server validators |
| Secret submission and OAuth operation lifecycle          | Existing Accounts adapters and forms                |
| Workspace access and personal ownership                  | Existing account/binding authorization policies     |
| Default, model selection, repository overrides           | Existing provider profile/selection use cases       |
| Navigation and explanatory text                          | Dashboard presentation                              |

The native companion includes an additive PostgreSQL guard migration: valid
OpenRouter enrollment model IDs follow the native syntax contract instead of a
two-ID whitelist. The migration preserves encrypted custody, immutable account
identity, and the existing insertion, promotion, update and deletion fences.
Applied historical migrations retain their original bytes.

The UI reuses the existing forms and readiness state machine. DRY here means one
owner for each rule and reuse of the richer existing components; it does not
mean merging distinct ownership and authorization responsibilities or adding a
universal wizard or new backend aggregate.

## Several simultaneous Gateway reviewers

The integrated implementation supports up to 16 Gateway reviewers, each with
its own account, model, review settings and vote identity. The same roster editor
serves workspace defaults and repository replacement; removing a repository
override restores the complete workspace roster. Existing `providerMaxParallel`
and `inlineMinAgreement` settings control concurrency and agreement.

Reviewers that use the same authorized account share its captured finite
allowance. Different account allocations retain independent limits. Required
reviewer failures remain in coverage, and the run produces one aggregate
GitHub App publication. The first captured reviewer supplies the existing
PR-description and lifecycle verification tasks, using its saved model without
promoting a sibling or choosing a fallback model.

The accepted [Gateway reviewers plan](../plans/2026-10-28-gateway-multi-reviewers.md)
records the implementation, boundaries and qualification. The
[deployment record](../deployments/2026-10-29-gateway-multi-reviewers.md) owns
paired application/Action adoption and live verification; source support alone
does not establish availability in an environment.

Mixed Gateway and GitHub Secrets/direct reviewers in one run remain a later
stage. Existing singleton direct, GitHub Secrets and Hosted Pool routes retain
their qualified contracts. The current transport eligibility checks reject
unsupported mixed execution.

## Acceptance boundaries

Focused checks cover provider/storage defaults, explicit Codex and Claude
choices, preservation of other connected providers, reusable account selection,
public metadata and account admission, connection intent return, workspace
navigation, one personal management controller, and OAuth/credential recovery.
Catalog tests cover successful refresh, errors, cooldown, stale data, fallback,
and pricing/capability normalization. Compilation and architecture checks cover
the changed dependency edges.

Component tests and local HTTP fixtures do not prove a production deployment,
live provider availability, or a real repository review. Those results must be
reported separately when actually run.
