# ADR-031: Review Skills content, authority and captured execution

Status: Accepted for this additive implementation, 2026-10-21.

## Context

Users need one editable Skills library that can be applied to several repositories and linked across workspaces. OCR is the default reviewer and the native reviewer must consume the same instruction contract. ADR-005 already establishes feature-first DDD/Clean Architecture, ADR-028 owns admission and immutable execution evidence, and ADR-001 keeps repository source content in execution runtimes.

## Decision

The new review-skills context owns originals, immutable revisions, direct use grants, generation-bound destination acceptance, and repository bindings. Source custody and authorship are distinct: only the original author with current source membership can change content. Source/destination admins can grant/accept use, never take over authorship. Repository-only SCM writers receive a narrow assignment capability, not library content or sharing authority.

Web-authored Markdown is intentional user-managed content. It is stored as bounded immutable revisions and captured private authorization attachments. Git-backed SKILL.md/resources remain in the execution runtime; the control plane stores only explicit source roots and an immutable trusted base commit. This decision does not authorize storing repository files, provider prompts, credentials or raw model responses in SaaS telemetry.

The app composition connects Skills to run-control through a consumer port and the existing operation-specific Serializable admission transaction. It prelocks the complete captured workspace set before existing runtime/configuration locks. New admissions revalidate assignments, links and grants; admitted runs retain their immutable input for their authorized lifetime. Revoke affects new admissions and never silently removes instructions from a run. Original lookup/restore precedes mutable selection, including racing denial paths.

A versioned published Skills contract and a run-authorized bounded companion endpoint transport the captured set outside environment variables and existing strict runtime-config envelopes. Registered producer profiles explicitly advertise support. Runtime materializes Git from the fixed base, then projects the same effective per-path bundle to OCR and native. Unsupported or invalid required input fails before inference/cache reuse. Historical absence retains old identities and OCR rendering.

Get Modular is adopted only for the new feature composition (borrowed Store/Access inputs and one application module). Foundation/FMS check the declared scope and dependency directions. User Skills are data, not executable modules. No generic transaction framework, plugin lifecycle, marketplace, new workspace roles or organization-wide tooling migration is introduced. Existing ADR-030 certification remains unchanged.

## Consequences

Save creates a new revision automatically; subsequent runs use it. Same-run retries restore persisted winner bytes. Cross-workspace links stay synchronized without copies, but a revoked/reissued grant requires fresh destination acceptance. A departed author freezes editing while existing legitimate consumption continues. Revoked targets receive generic unavailable projections instead of fresh source metadata. Content history and captured run retention follow their respective ownership/lifecycle boundaries.

First release supports text and bounded Markdown references. Scripts, dependency installation and permission expansion are unsupported. Git sources are opt-in and show source/status in the web UI; there is no additional SaaS Git-body preview service. Bulk assignment is a bounded atomic delta and uses one application command from either navigation entry.

Implementation steps, exact APIs, limits, tests and rollout order are in [the implementation plan](../plans/2026-10-21-review-skills.md); three independent sequential review rounds are recorded [separately](../plans/2026-10-21-review-skills-reviews.md).
