# Provider registry and unified provider setup

## Status and scope

Implementation plan, revision 4, cleared by three sequential independent
critique/fix rounds before implementation. Baseline:
`origin/main` at `c24f79f21`, worktree branch `feat/unified-provider-setup`.

Owner request: stop the per-repository "Set up provider" dead end, replace the
old "Connect model credentials" dialog and the newer "Configure providers"
dialog with one provider-and-model form, keep a workspace-wide list of providers
the user already attached and let them be reused, and make a repository inherit
the workspace default provider when it has none of its own. Breaking changes
and legacy deletion are allowed: there are no active users, so no compatibility
layer or parallel old/new path is kept.

The two credential delivery paths in scope are the server-managed Account
Gateway (sub2api) and GitHub Actions secrets. GitLab CI is a later delivery
path and out of scope; GitLab repositories keep today's "not available yet"
state in the new dialog. New domain types avoid GitHub-specific names where this
costs nothing.

## Owner decisions (fixed, not reopened by review)

1. **Registry.** A provider profile in the workspace list = credential source +
   model. Attaching a provider to a repository always registers it in the
   workspace list and never makes it the workspace default. The default is a
   separate explicit action. A repository with no selection uses the workspace
   default. Selecting a provider is required only when there is neither a
   workspace default nor a repository selection.
2. **Permissions.** Any member with repository maintainer rights may create a
   profile and attach any existing workspace profile to repositories they
   maintain, including profiles created by other users. Only a profile's creator
   may edit or delete it. A new workspace setting under Dashboard -> Other ->
   "Access rights" (default off) is editable only by owners and admins; other
   members see it disabled. When it is on, only owners and admins can manage
   profiles and provider selections (exact scope in the permission table).
3. **Profile editing.** A profile's model and label are editable in place and
   the change applies to every repository using it. The credential source and
   auth mode are immutable, so an edit can never change the workflow transport.
   Reasoning/fast/agentic settings live in each selection, not in the profile.
4. **Rotating Codex.** Repository-level only, never a registry default, not
   shown where the deployment flag disables it.
5. **Stepper.** A line "Provider: X - Change" sits above the stepper. If a
   workspace default exists it is shown as already selected until the user
   changes it. The stepper keeps its setup steps and shows a credential step
   only when the effective provider needs one.
6. **Existing dev data.** Kept through a small one-time script (S4), not a
   compatibility layer or a migration framework.

## Open questions with the default the plan takes

Raised by review; the owner may overrule them, the plan proceeds with the
default:

- Owners and admins may also edit or delete any profile (default: yes).
- Setting the workspace default is owner/admin only, whether or not the Access
  rights setting is on (today saving workspace policy is admin-only). Known
  tension: by decision 3 a creator editing the model of the profile that is the
  workspace default changes the default's model for every inheriting
  repository; the plan keeps decision 3 and relies on the Access rights setting
  to restrict it.
- Only workspace members create profiles. A GitHub collaborator who is not a
  workspace member cannot create one, although repository mutations fall back to
  GitHub permissions for non-members today.
- Uploading or rotating a managed API key (MiMo/OpenRouter) stays owner/admin.
- Creating, attaching or editing a profile over a personal gateway binding is
  owner/admin (in a personal workspace, its owner).

Defaults taken for the rest: the stored model allows 1..16 providers per scope
while the UI offers one; the Claude Code token stays a user-managed CI secret
verified per repository; hosted pool stays an existing option behind its flag;
dead auth modes `codex_subscription_oauth` and `codex_openai_api_key` are
removed in a separate small commit before S4.

## Verified facts the plan relies on

Sources: independent read-only code reviews of the baseline.

- On hosted deployments rotating is disabled
  (`scripts/deploy-render-hosted-beta.mjs:1111`,
  `scripts/check-hosted-readiness.mjs:38`). The repository setup panel always
  has step 3 and only changes its title: "Activate provider" when the effective
  config uses rotating (`repository-setup-progress-panel.tsx:536-541`). The
  step button's label and dialog are decided on the page
  (`dashboard-workspace-page.tsx:3086-3117`, `:3273`) and open the old dialog.
  Whether the step can complete after a provider switch is an assumption to
  confirm in S5.
- The new dialog cannot target one repository: it takes targets from a
  table-wide selection context (`provider-application-dialog.tsx:42`).
- Workspace policy is required with at least one provider
  (`review-configuration.ts:182`); a repository policy is a partial override
  replacing the provider array as a whole (`:296`). Saving a repository policy
  without a workspace policy throws `review_workspace_policy_required`
  (`prisma-review-configuration-repository.ts:405-411`) and the page then shows
  "Save workspace review settings before enabling reviews"
  (`dashboard-workspace-page.tsx:1651-1656`).
- The same constant `REVIEW_POLICY_SCHEMA_VERSION = 3` is used for the stored
  document and the runtime config; runtime snapshot code, `provider-runtime-plan`
  and the replay checks accept only 3. (Migration `000132` has a CHECK on
  `ReviewRunAuthorization` snapshot version, which is a different version.)
- The version writer projects `providers[0]` into NOT NULL columns
  (`000001_init`) with CHECKs (`000119`, recreated in `000126`); the child table
  `ReviewConfigurationVersionProvider` has the same CHECKs. The only reader of
  the projection is `apps/web/src/server/account-usage.ts:74-86,147-150`
  (binding usage on the Accounts screen); there is also an FK restrict to the
  gateway binding.
- The workspace+repository resolver is duplicated in `action-control-plane`
  (`prisma-action-control-plane-repository.ts:142-197`, `findLatestPolicyVersion`),
  a third mini-resolver is `apps/web/src/server/review-policy-heads.ts`, and the
  batch reader `findLatestReviewConfigurationsForRepositories` composes policies
  a fourth time. Behavior differs: one throws `review_policy_resave_required` and
  runs RepeatableRead, others return null; callers distinguish the cases
  (`review-run-runtime-snapshot.ts:189-195`). Snapshots and the operator API use
  version, workspaceVersion, repositoryVersion, `effectivePolicyDigest`,
  `revisionToken`.
- Readiness is computed in three places; the repository search route omits the
  gateway branch (`repositories/search/route.ts:247-271`).
- Workflow content depends on the delivery transport
  (`provision-reviewrouter-workflow.ts:125-141`). Gateway and provider-API
  workflows share one path; rotating and hosted pool share another
  (`workflow-template.ts:126,229`, `octokit-workflow-setup-gateway.ts:396,411`),
  so the transport cannot be derived from `workflowPath`. `beginAttempt` stores
  only `workflowPath`, `workflowStyle`, `actionVersion`.
- A CI-secret provider inherited from the workspace default is not ready until
  the secret exists in that repository.
- The GitHub App can write repository secrets, read but not write organization
  secrets (`ai-docs/decisions/008-shared-github-app.md:33-34`); organization
  secret checks are admin-only (`actions.ts:1152`).
- Workspace role is `owner | admin | member` (`schema.prisma:3936`), checked via
  `assertWorkspaceAdminAllowed` including a local-admin env override. Repository
  capabilities are `repo_manager` (write and above) and `direct_config`
  (maintain and above) (`dashboard-access-policy.ts:6-46`); repository
  secret/setup actions use `repo_manager`, repository policy saves use
  `direct_config`, and both fall back to GitHub permissions for non-members
  (`dashboard-mutations.ts:168-195,230-256`).
- `ProviderApiKeyConnection` is unique per `[workspaceId, providerType]`; applying
  a key to repositories is admin-only with an entitlement
  (`api/dashboard/provider-keys/apply/route.ts:46-60`). Hosted pool selection
  needs admin, entitlement and visibility (`hosted-pool-dashboard.ts:387-396`,
  `actions.ts:745-755`) and is a multi-step flow (binding, setup PR, activation).
  The pool of a repository comes from `HostedCodexRepositoryBinding`, not from
  policy. Personal gateway bindings require owner/admin
  (`lockPersonalWriteActor`, `prisma-review-configuration-repository.ts:776-825`).
  The gateway profile ref is fenced: a mismatch refuses a save
  (`review_configuration_gateway_profile_mismatch`, `:882-883`) and an admission
  (`review-run-runtime-snapshot.ts:317-318`).
- A rotating provider instance is created lazily when its setup command is
  issued and is deleted with its repository (`schema.prisma:623-632`).
- Providers are written by: dashboard workspace and repository save actions
  (`actions.ts:2790`, `:2939`), gateway batch, the hosted pool switch
  (`prisma-hosted-pool-configuration.ts:49`, which rewrites `authMode` in
  place), the operator API (`prisma-review-configuration-operator-mutation.ts`),
  the initial workspace policy draft (`initial-workspace-review-policy.ts`) and
  two e2e harnesses.
- `(id, workspaceId)` unique keys exist on `WorkspaceAccountBinding`,
  `RepositoryConnection`, `ProviderApiKeyConnection` and `HostedCodexPool`, and a
  precedent of an optional composite FK sharing `workspaceId` exists
  (`ReviewConfigurationVersion.gatewayBinding`).
- Each Prisma migration also requires updates to the release handoff policy and
  rehearsal inventories; PR #646 shows the file set for one migration:
  `release-migration-transition.test.ts`,
  `codex-rotating-release-migration-workflow.test.ts`,
  `provider-key-checkout-admission.test.ts`,
  `scripts/lib/render-historical96-checkout.mjs` (+test),
  `scripts/lib/render-schema-handoff-policy.mjs` (+test),
  `render-schema-handoff-transaction.test.ts`,
  `scripts/rehearse-private-pg17-rollout.mjs` (+test); rule in
  `ai-docs/operations/07-environments-and-release-management.md` (Database
  Release Rule).
- The local copy of the action repository does not branch on
  `review_workspace_policy_required` (only reads the env name
  `REVIEWROUTER_CONFIG_SCHEMA_VERSION`); re-check against the current remote at
  S4 start.

Facts marked as assumptions are verified at the start of the stage that uses
them, not trusted from this document.

## Target model

Domain owner: `packages/features/review-config` (profiles live next to the
policy so they are read in the same transaction as policy documents).
Credential custody, secret installation and readiness stay in `provider-setup`.
No new package.

- `WorkspaceProviderProfile`: id, workspaceId, createdByUserId (nullable,
  `SetNull`; a null creator means owner/admin only, used for system creators:
  operator API and hosted activation), auth mode, credential kind,
  credential reference, model, label, archivedAt, identity key. Secrets are
  never stored in it. Credential reference per kind (a SQL CHECK requires
  exactly the reference column of the kind to be non-null):
  - `gateway_binding`: composite FK `(bindingId, workspaceId)` plus the gateway
    profile ref captured at creation as part of the immutable credential source;
    save and materialization keep today's mismatch refusal and readiness shows
    "account profile changed, create a new provider";
  - `managed_api_key`: composite FK to `ProviderApiKeyConnection`;
  - `hosted_pool`: no credential reference (the pool comes from the repository
    binding);
  - `repository_rotating`: composite FK to the repository (cascade); usable only
    for that repository, never the default;
  - `user_ci_secret`: no reference (verified per repository).

  The same-workspace rule is enforced by composite foreign keys; the key and
  binding references use `NoAction` so cascading workspace deletion is not
  blocked.

- Identity key: `credentialKind:credentialRef-or-authMode:normalizedModel`,
  unique per workspace and recomputed on edit; for `gateway_binding` the
  credentialRef part is `bindingId/gatewayProfileRef` (the captured ref), so a
  profile-ref change yields a new identity and "create a new provider" creates a
  distinct profile, and the stale one can be archived once unused. A model edit
  that collides is refused with `provider_profile_duplicate`; archiving clears
  the key so the same provider can be created again. A label must not match the
  secret-looking prefixes already rejected by the CHECK in migration `000119`
  (`sk-`, `ghp_`, `github_pat_`, `xox[baprs]-`). find-or-create never catches a
  unique violation inside the interactive transaction; outside Serializable it
  uses `createMany({ skipDuplicates: true })` and reads back.
- Stored policy document schema is `v4`; the runtime `ReviewConfiguration`
  schemaVersion stays 3 (separate constants). In `v4`, `providers` is a list of
  selections
  `{ profileId, reasoningEffort, fastMode, agenticContext, requiredHealthy, agentProfileRef? }`.
  The workspace list is optional (absent = no default); the repository list is
  optional (absent = inherit).
  `execution.providerLimit` is derived from the selection count and not stored.
  The stored `providerMaxParallel` and `inlineMinAgreement` must fit the
  selections they govern. Only one case is fitted at materialization: a
  repository that selects its own providers and inherits these limits from
  the workspace runs and agrees with at most as many providers as it selects
  (`min(stored, N)`). Limits a document stores next to the selection they
  govern (the workspace limits of the default, or a repository's own
  override) are never fitted on read or on write; an inconsistent document
  is `resave_required` and its write is refused with
  `review_execution_limits_incompatible`. The selection use cases (set
  default, assign, clear) lower the written document's own limits to the new
  provider count, so replacing a migrated multi-provider default with one
  provider never strands its limits.
- `resolveEffectiveReviewConfiguration` is the single resolver; it keeps the
  RepeatableRead root-client behavior and a transaction-reader overload for
  admission. Result: `ready` (carrying every field of today's
  `PersistedReviewConfiguration`: versions, `effectivePolicyDigest`, source,
  `revisionToken` inputs, plus the materialized runtime `ReviewConfiguration`
  and, from S4, the selections), `missing`, `resave_required` (the last two carry
  the nullable head versions `workspaceVersion` and `repositoryVersion` that
  `review-policy-heads.ts` returns today, so legacy policies keep CAS
  protection), and from S4 `provider_selection_required`; each caller maps these
  as it does today. From S4: no effective selection, including no workspace
  document, is `provider_selection_required`; unreadable or legacy data is
  `resave_required`; `missing` and its caller mappings are deleted. The runtime
  contract with the action repository does not change. The workspace read-model
  has optional providers; the first attach or default change creates the
  workspace document with built-in non-provider defaults (the values of
  `initial-workspace-review-policy.ts` without providers) in the same
  transaction, so a new workspace never hits "save workspace settings first".
- `resolveEffectiveProviderReadiness` is the single pure readiness function used
  by the dashboard page and the search route; it lives in
  `provider-setup/domain`, takes plain facts, including the required and
  installed workflow requirement, and imports nothing from `review-config` or
  `workflow-provisioning`; the app layer composes the facts.
- `requiredWorkflowTransport(config)` lives in `workflow-provisioning/domain`
  and replaces the scattered transport predicates. The transport alone is too
  coarse to decide whether a workflow must be updated (a CI-secret workflow
  forwards the MiMo key only when MiMo is selected), so the domain also owns the
  workflow requirement: the transport plus the provider kinds the rendered file
  carries, e.g. `ci_secrets+codex-mimo` or `rotating+claude`
  (`requiredWorkflowRequirement`, `renderedWorkflowRequirement`).
  `WorkflowProvisioning` is one row per repository, so it gets two nullable
  TEXT columns with a format CHECK, `attemptWorkflowRequirement` and
  `installedWorkflowRequirement`. The attempt requirement is written together
  with `workflowPath` by every attempt writer: `beginAttempt` (from the static
  runtime env the template renders from) and the hosted resume in
  `hosted-pool-operator-connect.ts`. `markConfigured` copies it to the installed
  requirement. `confirmInstalledWorkflow` (create branch and transition) sets
  the installed requirement from the artifact it actually verified, not from
  the policy read before the hosted/rotating activation switched it. Transfer
  invalidations leave it unchanged. Existing rows stay NULL, meaning unknown and
  treated as "no update required"; the S4 script fills the installed
  requirement from the v3 effective config only for rows with
  `status = configured`. "Workflow update required" is derived by comparing
  the required and installed requirement, never stored as a flag; while a
  hosted pool binding exists the hosted and rotating workflows count as one
  family, because the policy and the workflow switch at different moments.
- Concurrency: a profile model edit and an archive take the workspace-exclusive
  scope guard (repository writers hold the workspace guard shared, so this
  serializes them with every selection write), then `Workspace FOR NO KEY
UPDATE` (it conflicts with admission's `FOR UPDATE` and with every other
  provider write, including the Access rights toggle, but not with foreign-key
  checks of inserts), then `lockPersonalWriteActor` for the actor and donors,
  then the binding locks of the affected bindings
  (`lockProviderAccountBindingUses`), then the `ReviewConfiguration` rows, then
  the profile `FOR UPDATE`; this is the admission order extended with the
  documented Member, Source, Binding order, so they are serialized against
  admission and saves without new locks on those paths. A label edit changes
  no configuration and takes only the Workspace lock. Selection writes (set
  default, assign, clear, form saves) take their target guards and the
  Workspace lock and end with `FOR SHARE` on the selected profiles, so a
  concurrent archive either waits or forces a serialization retry. Scope guards cannot be
  extended inside a transaction (`current_scope_guard_plan_extension`): a
  transaction that may write the workspace document and repository documents
  (first attach when the workspace head is absent, the S4 script) declares
  `[workspace exclusive, each repository exclusive]` in one
  `acquireCurrentScopeGuards` call before any other lock and rereads; assign and
  clear run one transaction per repository, as the gateway batch does today. A
  profile edit writes an audit event listing affected scopes because it creates
  no new policy versions. One shared "validate effective configuration" use case
  wraps today's save-time checks (context selection, gateway catalog and agent
  profile, codex production and rotating guards, entitlement, visibility,
  `assertGatewaySelections` with the editing actor as personal write actor).
  Network-bound checks and one rate-limit token run before the transaction;
  database-bound checks run per affected scope inside it.

### Permission table

Capabilities: `repo_manager` (write and above), `direct_config` (maintain and
above), as today.

| Action                                                                                           | Who (setting off)                                                                                | Who (setting on)    |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------- |
| Create a profile from the Providers list (gateway binding, existing managed key, user CI secret) | owner/admin                                                                                      | owner/admin         |
| Create a profile inside an attach flow for repository R                                          | workspace member with `direct_config` on R                                                       | owner/admin         |
| Create, attach, set default or edit a profile over a personal gateway binding                    | owner/admin (in a personal workspace, its owner), as `lockPersonalWriteActor` requires           | same                |
| Upload/rotate a managed API key                                                                  | owner/admin                                                                                      | owner/admin         |
| Edit model/label, archive                                                                        | creator who is still a workspace member; owner/admin                                             | owner/admin         |
| Attach a gateway or user-CI-secret profile to repository R / clear selection                     | `direct_config` on R                                                                             | owner/admin         |
| Attach a managed-key profile to repository R                                                     | `direct_config` on R if the key is already applied to R, otherwise owner/admin (applies the key) | owner/admin         |
| Attach a hosted-pool profile                                                                     | owner/admin through the existing hosted session-source flow (entitlement, visibility)            | owner/admin         |
| Set workspace default                                                                            | owner/admin                                                                                      | owner/admin         |
| Install/verify a user CI secret in repository R                                                  | `repo_manager` on R                                                                              | `repo_manager` on R |
| Change the Access rights setting                                                                 | owner/admin                                                                                      | owner/admin         |

A single pure `ProviderManagementPolicy` decides these and returns a reason for
each denial so the UI can explain disabled controls. Repository save and clear
actions with the setting on only let a non-admin change the non-provider fields:
the policy compares the old and new selection. Every create, edit, archive,
default change and setting toggle writes an audit event.

Endpoints that write a provider selection and must go through the policy:
workspace and repository save actions (`actions.ts:2747`, `:2859`), clear
(`:3004`), the hosted session-source action (`:403`), the gateway batch action
(until S5 deletes it), the new create/edit/archive/assign/clear/default actions
and the Access rights toggle. Exempt as system or operator paths: the operator
API mutation, hosted pool workflow activation, the S4 script. Endpoints that
write secrets keep their own checks: provider key apply (admin), secret confirm,
rotating setup command/recovery, setup PR creation.

## Stages

Each stage builds, passes its checks and is committed on its own. No stage keeps
a shim for the old behavior it replaces. Each migration updates the handoff
policy and rehearsal inventories listed above with their tests in the same
stage, and `pnpm architecture:check` and `pnpm db:migrate:smoke` join the
checks for it.

### S0 - Prerequisite

PR #646 (workspace draft reviews, Dashboard -> Other) is completed and merged by
a separate worker. It gates S3 and S6 only; S1, S2 and S3b start before it. S3
extends its settings adapter to accept a transaction client and expose
`providerManagementAdminOnly`, reusing its admin check for the disabled state.
The Access rights toggle uses its own server action that writes only its column
(the existing draft-review action writes a boolean from its form value and would
reset drafts).

### S1 - Single effective-config resolver

Move workspace+repository resolution into one `review-config` use case with
variants `ready | missing | resave_required` (the last two carry the nullable
head versions), and call it from
`action-control-plane`, the batch reader and the dashboard, deleting the
duplicates, `findLatestPolicyVersion` and `review-policy-heads.ts`. Callers keep
their error mapping. No behavior change.

Done when: `rg findLatestPolicyVersion packages/features/action-control-plane`
and `review-policy-heads` are empty; existing runtime-snapshot, OIDC and
admission tests pass unchanged; the resolver test passes.

### S2 - Single readiness and transport function

Add `resolveEffectiveProviderReadiness` (by auth mode and today's evidence; the
credential-kind input arrives in S4) and `requiredWorkflowTransport`. Replace the
readiness logic in the dashboard page and the search route, fixing the missing
gateway branch. Delete the replaced helpers. Step ids become semantic instead of
numbers; search filters and the stepper use the ids. No migration.

Done when: the old helpers are gone (`rg`); for one fixture table the page and
the search route produce the same readiness including gateway; the readiness
test passes.

### S3 - Registry storage, permissions, setting, installed workflow requirement

One migration (the only one in this plan): `WorkspaceProviderProfile` with
composite FKs and the exactly-one-reference CHECK; the workspace setting
`providerManagementAdminOnly` (default false); `attemptWorkflowRequirement` and
`installedWorkflowRequirement` (NULL for existing rows); `DROP NOT NULL` on
`ReviewConfigurationVersion.providerKind, providerAuthMode, model,
reasoningEffort, failOnSeverity, inlineMaxComments, targetTokensPerBatch` (the
child table is unchanged; CHECKs stay, a NULL passes them; v4 writers omit all
projection columns and the defaulted ones carry meaningless defaults on
schemaVersion 4 rows that nobody reads). Prisma adapter,
find-or-create (race-safe on the unique key), list without usage, label edit,
`ProviderManagementPolicy`, audit events, recording the attempt requirement and
copying it to the installed requirement, wiring it into readiness. No set-default,
assign, clear, usage, archive or model-edit logic (they need selections and land
in S4). The v1-v3 projection columns and child rows stayed as historical data
of existing versions and nothing new was written to them after S4; migration
000146 (S7) drops them.

Done when: migration smoke and architecture checks pass; handoff files updated;
Postgres tests prove a cross-workspace insert is rejected by the FK, a
find-or-create race yields one row, and an attempt's workflow requirement
reaches `installedWorkflowRequirement`.

### S3b - Dead auth modes

A separate small commit before S4: remove `codex_subscription_oauth` and
`codex_openai_api_key` from the catalog, workflow templates, usage provider and
guards. Done when `rg 'codex_subscription_oauth"|codex_openai_api_key'` outside
tests and old migrations is empty. Optional tidy-up, not required for the goal;
it narrows the catalog the new dialog renders.

### S4 - Policy v4, writers, profile lifecycle, one-time script

No new migration.

- Stored schema 4 with selections and optional workspace providers; runtime
  schema stays 3; `execution.providerLimit` derived;
  `review_workspace_policy_required` becomes `review_provider_selection_required`
  (map HTTP codes in `register-action-control-plane-routes.ts`; re-check the
  action repository does not branch on the old code).
- Switch every reader and writer, including those found by review: the repository
  search route, the dashboard page fallbacks to the active config, replay of
  receipts with `schemaVersion !== 3`, the operator read and PATCH (keeps its
  external contract and writes selections), `provision-reviewrouter-workflow.ts`,
  `prisma-hosted-codex-grant-admission.ts`, hosted pool workflow activation,
  rotating lease finalize, OIDC exchange, dashboard copy and error codes, the
  form readers and the repository policy editor types (S4 adapts types and form
  readers to v4; fields and layout change in S5), `initial-workspace-review-policy.ts`
  and both e2e harnesses. `apps/web/src/server/account-usage.ts` is rewritten to
  read binding usage from v4 selections through the same usage-count use case as
  the Providers list.
- Dashboard actions keep their current form fields, call find-or-create for the
  profile and save a selection; the gateway batch action, adapter and controls
  are deleted here (the replacement is `assignProfileToRepositories`, reached
  from the dialog in S5; until S5 the header "Configure providers" bulk action
  is the only capability removed, as the table-wide selection is rebuilt); the hosted pool switch
  selects a hosted-pool or rotating profile instead of rewriting auth mode, and
  `isCodexRotatingOAuthAllowedForWorkspaceDefault` and its two UI uses are
  deleted.
- Profile lifecycle use cases: set default, assign to repositories, clear
  selection, usage counts, archive (refused while used), model edit (refused with
  the affected repositories when stored reasoning/fast settings do not fit the
  new model; revalidates every affected scope as the editing actor). They write
  only policy and audit; they never open setup PRs or write secrets. Affected
  repositories get derived statuses (workflow update required, secret missing)
  and a maintainer acts.
- Rewrite the Postgres tests that assert v3 shape, CHECKs and NOT NULL (gateway
  configuration, runtime snapshot, provider-accounts fences).
- One-time script `scripts/migrate-provider-profiles.ts` (Prisma only): per
  workspace, in one transaction using the same find-or-create path, create the
  profiles needed by the v3 heads and append a v4 version; creator =
  `personalOwnerUserId`, else the earliest owner, else the earliest admin, else
  skip the workspace with a warning, and that same user is passed as the
  personal write actor for validation; the workspace head is converted first,
  then repository heads, under the up-front guard declaration above; workspaces
  being deleted are skipped; a v3 workspace default that uses rotating is not
  kept as a default (rotating is repository-level only): the workspace document
  keeps its settings without a default, and each repository that inherited it
  gets its own rotating selection where the deployment allows rotating for that
  repository (`isCodexRotatingOAuthAllowedForRepository`), so it keeps reviewing
  exactly as before; the others are listed in a warning; v1/v2 history and
  provider lists the write would refuse are skipped with a warning, the rest of
  the workspace converts (Gateway rows are checked in the transaction with the
  write path's own `readSelectableGatewayProfileRef` and personal-actor rules:
  unavailable binding, personal binding without sharing or without the creator
  as write actor, changed account profile; OpenRouter without a managed key);
  fills `installedWorkflowRequirement` from the v3 effective config; prints a
  per-workspace summary; skipping already-v4 documents makes reruns safe. An
  unconverted v3 head makes the new app fail closed with `resave_required`. Order
  for each environment (developer database, hosted beta, any other): stop
  writers (the whole old fleet), apply migrations, run the script, start the new
  app. Take a `pg_dump` first. Preflight: 000145 was corrected in place before
  release and
  `prisma migrate deploy` does not reapply a migration whose checksum changed, so
  the script refuses a database whose `_prisma_migrations` checksum for 000145
  differs from the SHA-256 of the checkout's file
  (`provider_profile_migration_stale_000145`); such a development database is
  recreated. The rebase onto main renumbered the provider migrations from
  000144/000145 to 000145/000146 after `000144_review_statistics`; a
  development database that applied them under the earlier names is recreated
  too (the script then reports 000145 as not applied). `--dry-run` runs the
  same per-workspace transactions and rolls them
  back; a converted target whose schema 4 configuration differs from its
  schema 3 one is reported as a warning, never repaired. When a write still
  fails, the script finds the failing targets (each alone with the workspace
  document, rolled back), reports them with the creator and converts the rest;
  a failing workspace document fails the whole workspace.
  The script is never run against a production database without the owner's
  explicit instruction.

Done when: stored-document checks use the stored constant (4) and runtime checks
use `REVIEW_POLICY_SCHEMA_VERSION` (3), with no literal `schemaVersion !== [34]`
outside tests; no writes to `ReviewConfigurationVersionProvider` remain; both e2e harnesses pass;
the script on a copy of the developer database prints its summary and a rerun
changes nothing; tests for edit/archive refusals and their race, the
materialization equivalence and the no-secret invariant pass.

### S5 - Unified provider dialog and stepper line

One `ProviderSetupDialog` with a `target` of one repository, many repositories
or the workspace, used by the "Provider" line above the stepper, the repository
row indicator ("Using workspace default: X - Use a different provider"), the
table header bulk action and the Providers list. Body: existing profiles first
or add new; credential source rendered from server-computed option view models
with reasons for disabled options; shared `ProviderModelFields`; delivery panels
reused from the current code (gateway: none; GitHub CLI verify/manual confirm;
server-installed key for MiMo/OpenRouter; rotating isolated, moved as-is). The
"Use as workspace default" switch exists only when the target is the workspace
and is preselected only if no default exists and the actor may set one;
repository targets never offer it. The derived per-repository "update setup PR"
and "add secret" actions live here. One completion hook refreshes queries and the
server-rendered page. Mutations are server actions behind a typed adapter (they
carry origin protection and revalidation); React Query is used for reads (profile
list, secret status) with query keys beside the feature and deliberate
`staleTime`; first paint comes from the server component.

Delete the old chooser and dialogs, gateway batch controls and actions, the
standalone API key manager, the second policy-override editor and the
provider/model fields duplicated in `repository-policy-editor.tsx` (it keeps a
profile select plus the non-provider fields). Add only the shared primitives
actually needed (radio cards, dialog close button, select slots).

Done when: `rg` for `ProviderSecretSetupChooser`, `ProviderApplicationDialog`,
`GatewayRepositoryBatchControls`, `ProviderApiKeyManager` is empty; the dialog
opens for a fixed repository, and for none-selected, from the stepper line, the
row indicator and the table header; policy table tests pass.

As built: the workspace and repository settings forms submit no provider at
all (not even a profile select); the provider, its model and its
reasoning/fast/agentic settings change only in the dialog, which sends the
`profileId` of an existing profile, so a form opened before a provider change
can never revert it. "Remove all repository overrides" keeps the repository's
own provider; "Use the workspace default" in the dialog removes it. The
parallel/agreement limits are shown only where more than one provider is
selected. The Models section shows the default provider line and the
non-provider workspace settings; the repository list of the old second
override editor is gone (each repository row has its settings). A workspace
without a default shows the repository table with a "No default provider"
line. A fixture-only preview, `/dashboard/provider-setup-preview` behind
`REVIEW_ROUTER_ENABLE_PROVIDER_SETUP_PREVIEW=1`, renders the lines and the
dialog without a database for visual review; S7 qualifies the real pages.

### S6 - Providers list, Access rights, Model section

Dashboard -> "Providers": list with default badge, used-by counts, creator,
per-row actions allowed by the policy. The existing "Model" section keeps only the
non-provider workspace fields; the default changes only in the Providers list,
and the provider prefill in `initial-workspace-review-policy.ts` is removed.
Dashboard -> Other -> "Access rights": the admin-only toggle; members see it
disabled with the policy's reason.

Done when: a member sees the toggle disabled with the reason; with the setting on
a member's attach is refused (policy test); the Providers list shows only the row
actions the policy allows.

As built: "Providers" is a dashboard section between Accounts and Model. Each
row shows the name, where the credential comes from (a workspace account by
name, a shared personal account unnamed), the model, the Default badge, the
repositories that chose it, and who added it. `buildProviderListView` decides
every row action with `ProviderManagementPolicy` on the server: Edit (name and
model; the credential is shown as unchangeable), Make default (the shared
dialog opened on that provider), Remove as default, Remove (disabled while the
default or a repository uses it; the write's refusal names them) and, for a
managed key, Replace key (owner/admin, through the existing apply flow, which
is the consumer of `GET /api/dashboard/provider-keys`). An action refused for a
reason specific to its row (in use, a hosted pool, a personal account) stays
visible and disabled with that reason; an action refused for a reason the
list states once above it (owner/admin only, Access rights, only the person
who added it) is left out of the rows (changed in S7 after the visual review;
the owner kept it). "Add provider" is the shared dialog in
an `add` mode: it creates the profile and can also make it the default,
preselected only while there is none. Editing and removing pass a signed-in
gate instead of the admin gate so a member who added a provider can change
it; the policy decides under the write's locks. A model edit is validated by
`dashboardProfileModelChangeValidator`: the Gateway catalog before the
transaction, the save-time rules a model can change per affected scope inside
it, and a scope whose stored depth or fast mode the new model does not support
is refused as `provider_profile_model_incompatible` with its name. A label that
is still the generated one follows an edited model, so the default line and
the list never name an old model. The Model section keeps the default line,
which opens the same dialog, and links to Providers (the plan had the default
change only in the list; one shared dialog keeps one implementation and saves
a detour). Other gets an "Access rights" section with its own form and the
existing action; the policy reason reads "Only workspace owners and admins can
manage providers". The fixture preview takes
`?screen=providers&list=several|empty&viewer=owner|member&access=on|off` and
`?screen=other&viewer=owner|member&access=on|off`, and the S5 screens take `viewer` and
`access` too.

Deferred follow-up (no migration in S6, done in S7 by migration 000146): dropping the v1-v3 projection columns
of `ReviewConfigurationVersion` and the `ReviewConfigurationVersionProvider`
table. A search on 2026-10-24 found no reader or writer of the child table
outside tests (`gateway-configuration.postgres.test.ts`) and the generated
activation catalog artifact, and no writer of the projection columns since
S4, but one stale reader: `scripts/run-hosted-pool-production-canary.ts`
requires the latest version's `providerAuthMode`, `fastMode` and child rows to
name the hosted pool. On a schema 4 version they are NULL or absent, so that
canary now refuses with `hosted_pool_canary_hosted_dependency_contract_invalid`.
Fix that reader to resolve the effective configuration first, then drop the
columns and the table in one migration with the handoff inventories it needs
(about eleven files, see the Database Release Rule).

### S7 - Visual and end-to-end qualification, defect fixes

The existing accounts-reference harness blocks all external network, seeds
installations as suspended, has no repositories and no `member` user, and member
checks call GitHub. S7 therefore: (a) adds a preview route with fixture view
models for all GitHub-dependent states; (b) extends the harness seed with an
active installation, three repositories, a `member` user, profiles and policies;
(c) drives with Playwright only admin and no-GitHub flows. The preview route is
closed by an env flag following `hosted-pool-preview` (`notFound()` otherwise).
Run on a hosted worker; screenshots at 390 and 1440 widths in both themes into
`tmp/`, with 900 only for the main dialog. Fix
defects in the stages above that the review shows (no new features). Update the
docs that describe setup: `ai-docs/architecture/62-*` and this plan's status.

Done when: the full scenario set is captured and reviewed, Playwright is green on
the hosted worker, and leftover references to deleted code are gone.

As built: the qualification runs on the real app and PostgreSQL 17 with the
seed written through the `review-config` use cases. `pnpm provider-setup:visual
--flows` captures every scenario (step 3 and every other entry point of the
dialog, new providers of each credential kind, member and Access-rights
refusals, the Providers list and its dialogs, Other) at 390/1440 px (dialogs
also 900 px) in both themes, then runs seven end-to-end flows that check the
page and the stored result; an eighth runs with personal account sharing off
against a Gateway catalog fixture. Fixes from that review: the bulk dialog
keeps its target until it closes; a dialog without providers opens on the new
provider form; a refusal shared by every choice is said once; the Providers
list leaves out actions refused for a reason it states once; an opened
repository shows its provider line once; plain-language step 3; read-only Other
without save buttons; the Model badge no longer widens phones. Independent
review findings closed in S7: the profile gate runs before rate limits,
entitlements and network checks; selection writes replace a retired document
of their own scope with an audit event, but a repository choice never replaces
a retired workspace document (an owner or admin replaces it by choosing a
default, and the repository line says so); Gateway validation reads the
deployment catalog without the owner/admin Accounts context; the dialog never
selects a hosted pool; managed key saves are audited and refused while changes
are off, and an audit failure after a saved key is logged instead of failing
it; GitHub permission checks of a bulk view are bounded and the Gateway catalog
is read once per write. After the second review: Access rights, the hosted pool
refusal and the creator check of a model change run before quotas, GitHub and
the catalog; a bounded parallel map stops starting items after the first
failure; the one-time script retries a Serializable workspace pass longer, with
a random pause, because other workspaces' writes fail it spuriously. The hosted
pool canary resolves the effective configuration, and migration 000146 drops
the schema 1-3 projection columns and `ReviewConfigurationVersionProvider` and
keeps the format check of the remaining Gateway reference columns
(checkout-only; registration as for 000145). Release order (stopped fleet,
`pg_dump` first, no old-binary rollback): Database Release Rule in
[environments and release management](../operations/07-environments-and-release-management.md).

Rebase onto main (review statistics and Review Skills): the provider
migrations follow `000144_review_statistics` as 000145 and 000146. The
repository table keeps one selection, the neutral one Skills added
(`repository-action-selection.tsx`): "Manage skills" and "Configure providers"
both act on it, and "Configure providers" applies its own limit and refuses a
selection with repositories whose settings the viewer cannot change. The
Gateway adapter of that selection left with the Gateway batch dialog. Main's
Skills suites store schema 4 selections (the OpenRouter default through the
managed key, the rotating Codex fixture as a repository selection).

Prepared ahead of S5/S6: (b) and (c) are a separate seed and runner rather than
an extension of the accounts-reference harness, see
[provider setup visual qualification](../operations/provider-setup-visual-qualification.md).
The seed writes profiles and selections through the `review-config` use cases;
a GitHub HTTP fixture inside the Next server answers the repository permission
checks, so owner, admin and member flows run in the real app. The S5/S6
scenarios are listed there as pending until their UI lands; (a) remains for
states the fixture cannot produce.

## Explicitly out of scope

GitLab implementation; impact-preview dialog, acknowledgement digest and batch
"update N setup PRs"; automatic setup PRs or secret writes on default change;
multi-provider UI; hosted pool redesign; rotating redesign (it is moved, not
rewritten); wider UI primitive migration; renaming the runtime config schema;
dropping the remaining historical v1-v3 projection columns (retained as
history of existing versions, owner `review-config`, no new writes); changes to
the action repository `777genius/review-router`; changes to the Memory section.

## Checks and tests

Per stage: `tsc7 --noEmit` first, then the project typecheck, lint and format;
focused unit tests; for S3 the PostgreSQL 17 migration checks. Heavy runs
(PostgreSQL 17, Docker, Playwright) go to the hosted worker in an isolated
directory.

Tests are limited to risky invariants:

1. Resolver variants and precedence.
2. Attaching registers the profile and never changes the default; find-or-create
   is idempotent under a unique-key race.
3. `ProviderManagementPolicy` table including the setting, creator rules,
   personal bindings, managed keys, hosted pool, non-members and cross-workspace
   refusal.
4. Profile edit/archive refusals and the race of archive against a selection
   save.
5. Readiness truth table by credential kind, inherited CI-secret default with the
   secret missing, derived workflow-update-required, transport recorded per
   attempt.
6. Materialized config equals the previous effective config for migrated
   fixtures; the script is rerun-safe.
7. No secret value reaches a profile, label, identity key, audit event or
   runtime env.

## Visual scenarios (S7)

First provider via gateway; first provider via GitHub secret (CLI, not found,
confirm, from fixtures); repository inherits the default; repository overrides it
and returns to the default; bulk assign with one conflict; Providers list with
creator rules; personal binding disabled with a reason; archive refused; model
edit refused with the repository list; managed key not uploaded; a GitLab
repository; the admin-only toggle on/off as admin and as member; rotating
hidden/visible by flag; empty, loading and error states.

## Risks

- S4 is the largest stage and cannot be split without a compatibility shim.
- A model edit applies to every using repository at once by owner decision;
  validation and the lock protocol protect stored settings and in-flight runs.
- Using another member's profile reuses their credential reference; the
  permission table closes the managed key, hosted pool and personal binding
  escalations and authority checks run on every selection save and at admission.
- Setting a default or selecting a different-transport profile makes affected
  repositories show derived "update setup PR" / "secret missing" states that
  maintainers resolve one by one.
- Assumptions to check at stage start: the action repository does not branch on
  `review_workspace_policy_required` or the stored schema version; the step-3
  completion behavior after a provider switch.

## Estimate

About 32-40 working days for one developer across S1-S7 (S4 about 8-10 days, S5
about 6-8 days); about 22-26 working days with two executors. S1, S2 and S3b
start immediately and in parallel; S3 waits for PR #646 (migration handoff
inventories serialize); after S3, S5 view models and `ProviderModelFields`, S7
fixtures and harness seed, and the S6 toggle run in parallel with S4; only S4 is
strictly sequential.
