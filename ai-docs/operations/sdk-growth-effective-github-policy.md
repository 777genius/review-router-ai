# SDK growth effective GitHub policy checkpoint

Status: **read-only checkpoint; B2 activation HOLD**.

This checkpoint observes whether the existing target branch is effectively
configured to require the exact reserved check
`ReviewRouter / SDK growth authority` from a caller-supplied numeric GitHub App
ID. It does not create or update a ruleset, branch protection, check run or
merge. It does not contain a production App ID.

The public operation is `readEffectiveSdkGrowthGitHubPolicy`. Provider reads
are isolated behind `EffectiveGitHubPolicyObserverPort`; the Octokit adapter
normalizes transport responses and the SDK-growth domain makes the policy
decision.

## Qualification contract

`QUALIFIED` means only that one complete observation showed all of these facts:

- The exact repository ID, repository full name, target ref and target SHA were
  observed, and the ref had the same SHA before and after the policy reads.
- Repository rulesets were listed with `includes_parents=true`, all pages and
  every detail were read, and every effective branch rule referred to a known
  repository, organization or enterprise ruleset ID.
- An actively enforced rule requires the exact reserved context and the exact
  configured numeric App ID. A null `integration_id`, a different App ID, or an
  evaluate-only rule does not qualify. The effective branch rule's normalized
  App, freshness and creation parameters must also be present and agree with
  the corresponding ruleset detail.
- The exact check rule requires branch freshness and applies on ref creation.
- Effective pull-request, non-fast-forward and deletion rules prevent the
  intended gate from being skipped by a direct update or delete/recreate path.
- Rules used for qualification are inherited organization or enterprise
  policy. A repository-administered rule is observed but produces
  `INDEPENDENT_ADMINISTRATION_UNPROVEN`.
- Applicable rulesets contain no bypass actor. Classic branch protection is
  also read when present; its exact `checks[].app_id`, strictness, admin
  enforcement, PR bypass allowances, push restrictions, force-push setting and
  deletion setting are normalized. A conflicting wildcard or wrong-App
  classic check causes HOLD even if a ruleset is otherwise sufficient.
- The observation is no older than the caller's bounded freshness interval.

Unknown fields needed by those predicates, malformed data, denied reads,
missing inherited ruleset details, ambiguous ref patterns, malformed or
contradictory pagination links, a full result page without a valid provider
`Link` pagination proof, and any ref race are HOLD. Observation age starts at
the oldest contributing read, so provider latency consumes the caller's
freshness budget. The policy digest is SHA-256 over the canonically ordered,
normalized provider policy, repository/App identity and target ref (not the
observation timestamp); it is evidence identity, not a permission or lease.
When a complete policy cannot be read, the digest covers only the normalized
failure envelope and known IDs; the HOLD reason prevents treating it as policy.

The adapter follows GitHub's official REST documentation for:

- [Repository rulesets and rules for a branch](https://docs.github.com/en/rest/repos/rules)
- [Branch protection](https://docs.github.com/en/rest/branches/branch-protection)

Requests pin API version `2026-03-10`. The effective-rules endpoint establishes
applicability to the existing branch; detailed repository rulesets retain
inherited source and bypass configuration. Classic protection alone cannot
prove coverage for branch creation, so it cannot satisfy that predicate.
This bounded checkpoint does not qualify a merge-queue alternative to strict
branch freshness.

## Explicit capability limits

Even a `QUALIFIED` policy result leaves `atomicMergeBoundary.verdict` at HOLD.
GitHub's required-check and protection reads do not bind ReviewRouter's current
authority epoch, owner approval, expiry or revocation to an irreversible merge.
The following execution remains possible:

1. The configured App publishes success for SHA H under authority epoch E.
2. Authority is revoked, expires or is replaced without changing H.
3. GitHub continues to show the successful check for H.
4. A merge accepts H.

The APIs used here also do not prove custody of the App's runtime code or
credentials, the identities allowed to administer an organization or
enterprise ruleset, webhook delivery freshness, or a protected deployment's
current artifact. Numeric App identity and inherited ruleset source are useful
provider facts, not proof of those operational controls. The operation
therefore returns a separate `operationalControlBoundary` at HOLD with precise
App-runtime and ruleset-admin custody reasons, even when the effective provider
configuration itself is `QUALIFIED`.

Polling again, shortening an authority TTL, changing an older check after
revocation, requiring an expected head SHA, or holding a database transaction
during a provider request does not close the merge race. B2 must remain HOLD
until a separately reviewed merge boundary has both a provider-supported
linearization argument and adversarial same-SHA revocation evidence.
