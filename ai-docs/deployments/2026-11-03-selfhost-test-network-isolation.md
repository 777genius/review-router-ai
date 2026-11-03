# Stock self-hosted test network isolation

- Goal: finish isolated configured-HTTPS stock acceptance when the shared test host has exhausted Docker's predefined network pools.
- Implementation: source `b3613bfc012dc88015d9a9bf19be9cb27d67bd67`, [PR #803](https://github.com/777genius/review-router-ai/pull/803); normal protected distribution pending.
- Scope: optional test-runner `networkSubnet`, not product Compose, a feature flag, a daemon setting or a production network change.
- Related work: [explicit Memory resume](2026-11-02-memory-explicit-resume.md), [conversation qualification](2026-11-03-memory-current-source-evidence.md).

| Target                       | Status | Actual version / evidence                                                              | Remaining work                                                                                                        |
| ---------------------------- | ------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| production services          | `n/a`  | Existing official226/source6e unchanged                                                | No production activation belongs to this test-harness change.                                                         |
| hosted disposable acceptance | `PASS` | Source-only candidate `b3613bfc0`; original continuous stock session `88861` completed | Normal PR803 distribution remains pending; this is not official OCI, semantic qualification or production activation. |

## Retained failure

The separate source6e configured-HTTPS attempt `a8c443c26a700bb11e537a7e`
passed actual native first installation and idempotent reuse. First application
Compose network creation then failed with `all predefined address pools have
been fully subnetted`. It did not reach application readiness, storage or
configured-HTTPS resume acceptance. Its proxy exited normally and no UFW rules
were applied. The normal runner intentionally retained three native containers,
their two volumes and one empty application volume for exact owned cleanup.
This is neither continuous acceptance nor a physical Forget result.

No previous fully decommissioned stock network remains available to release a
pool slot. Do not delete foreign networks, change daemon pools, or rerun the old
attempt. Retained receipt SHA256:
`c1b4e65b22f28af73b43620f9b9d86390a95024c8cf1347a241a2d21b792f8df`.

## Harness behavior and source checks

A supplied canonical RFC1918 IPv4 `/24` is checked against bounded complete
Docker IPAM, host-interface and nondefault-route inventories before native
installation. One owned JSON Compose override adds only default-network IPAM;
the central argument builder carries it through every operation, including
teardown. Actual project/default-network labels and subnet are verified after
creation. Docker remains the atomic overlap owner if another operation races
the census. A refusal does not select another subnet or retry automatically.
Omitting the option retains the normal CLI/CI composition.

Remote source checks passed 19 Node cases, strict types, lint, pinned formatting,
runner syntax and a real Compose config-only merge. Two review corrections
added closed inventory failure diagnostics and the default-network label check;
their five targeted cases and strict/lint checks passed. A temporary QA config
type-resolution failure is retained; no source workaround or gate relaxation
was used. No network or container was created by config validation.

## Continuous hosted acceptance — 2026-11-03

The [exact sanitized continuous receipt](evidence/2026-11-03-selfhost-continuous-https.json)
records one original stock invocation, session `88861`, terminal exit **0** in
**666.523 seconds**, on candidate source `b3613bfc0`. The actual
`10.254.253.0/24` default network passed the complete inventory and owned-network
checks. Normal first installation and idempotent reuse, real Compose readiness,
and the first native preflight all passed. Actual `resumeMemory` derived the
configured HTTPS URL `https://10.77.0.1:34943` from the env file through a normal
trusted-CA TLS connection. The API stayed running; native IDs and saved bindings
were unchanged before the first Save or Forget.

Save published; readback, recall and foreign-user denial passed. Forget remained
`cleanup_pending`, with the native document still present and product read/recall
excluded. No signed physical Forget is claimed. The exact three temporary
private ingress rules were applied and rolled back once; foreign rules and IPv6
were preserved without reload. The proxy's observed exit was code 0. Normal
owned decommission plus independent readback confirmed no owned native/Compose
containers, volumes or network, no private TLS listener and zero persistent or
live owned UFW rules. External generative model calls and production changes
were zero; native local embeddings and reranking were exercised.

The first absence collector did not recognize Docker's `network not found`
wording. Its corrected read-only classification and complete 35-network census
confirmed absence without repeating any effect. Earlier failed source6e/657
stock runs, the b53 continuation and the separate failed v2 operator attempt
remain historical failures or separately scoped evidence; none is relabelled.
Original raw receipt SHA256: `1faeb3017df07c1862001ada68c92a9b4b59af66554d78bf0938e98518f1198f`;
retained unchanged in the operator evidence. The repository copy uses pinned
Prettier formatting, SHA256 `72f34c76b3a9018d2865ebea28f7f66cbea686ae9e0362b5a9ed2f90ec157c73`,
with identical parsed fields.

## Remaining steps

The first full PR803 CI run `41627891772` passed the real self-hosted E2E,
but root Vitest also discovered the new `node:test` file and reported no Vitest
suite. Register it beside the existing self-hosted Node exclusions; it remains
executed by the normal self-hosted acceptance entrypoint. This changes test
runner selection only, not the verified candidate runtime behavior.

1. Complete normal PR803 protected distribution. Hosted candidate acceptance is
   complete; production services are `n/a` for this harness-only change.
2. Keep genuine capability-bound release first-install/update and automatic
   conversational learning qualification separate. This source-only candidate
   has no official OCI or semantic capability; installed production remains
   source6e with qualification and interaction pin unset.

Rollback is omission of the optional test input or an ordinary source revert.
This task adds no data migration, product setting, service restart, qualification
declaration or signed physical Forget claim.
