# Providers and connections UX

Scope: the provider setup and connection management changes of 2026-10-28.
This updates the navigation and presentation described in the
[repository onboarding plan](../plans/2026-10-26-repository-provider-onboarding.md).
It does not change credential custody, workspace authorization, repository
readiness, runtime admission, or the release process.

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
- **All my connections:** which connections the current user owns, including
  connections that have not been shared with this workspace.

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

The currently pinned OpenRouter Gateway/native path has a fixed admitted model
set. Displaying the full public catalog cannot expand it. Models outside that
set remain unavailable in ReviewRouter storage, while the GitHub Secrets path
retains its existing direct-model rules. The implementation does not remove a
runtime check to make a dropdown appear functional.

Full dynamic OpenRouter execution through ReviewRouter requires a separate
qualified change to Gateway and native: extend their existing model-catalog
contract, validate requested models against an authoritative snapshot, preserve
the immutable enrollment anchor and account fences, then update the SDK pin and
activate the compatible deployment. That work is outside this UI/catalog slice.

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

No universal wizard, new backend aggregate, database migration, credential copy,
or second readiness state machine is introduced. DRY here means one owner for
each rule and reuse of the richer existing components; it does not mean merging
distinct ownership and authorization responsibilities.

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
