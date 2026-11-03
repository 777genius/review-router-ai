# Stock self-hosted test network isolation

- Goal: finish isolated configured-HTTPS stock acceptance when the shared test host has exhausted Docker's predefined network pools.
- Implementation: `fix/selfhost-test-network-isolation`; final PR/source pending.
- Scope: optional test-runner `networkSubnet`, not product Compose, a feature flag, a daemon setting or a production network change.
- Related work: [explicit Memory resume](2026-11-02-memory-explicit-resume.md), [conversation qualification](2026-11-03-memory-current-source-evidence.md).

| Target                       | Status        | Actual version / evidence                                 | Remaining work                                                                                                  |
| ---------------------------- | ------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| production services          | `n/a`         | Existing official226/source6e unchanged                   | No production activation belongs to this test-harness change.                                                   |
| hosted disposable acceptance | `in_progress` | Remote source QA passed; no stock run with the new option | Bind the reviewed immutable source/operator, check one actual subnet, then complete the normal stock lifecycle. |

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

## Remaining steps

1. Complete source review and normal PR/CI, preserving the four Memory quality
   sources, model selection and protected corpus.
2. Bind the exact candidate source and actual QA evidence to the reviewed
   operator. Candidate-source QA is not official OCI or semantic qualification.
3. Check one concrete subnet through the actual complete read-only inventory;
   retain any refusal without allocator/search retries.
4. Execute one new original stock invocation with the reviewed HTTPS/UFW owner.
   Verify ordinary installation/reuse, storage, high-level resume, scoped ingress
   rollback, observed proxy exit and exact resource absence.
5. Reconcile the retained source6e sandbox separately through its existing
   locked `disposeSelfHostedMemory` owner. A bounded continuation or cleanup does
   not turn its failed run into continuous acceptance.

Rollback is omission of the optional test input or an ordinary source revert.
This task adds no data migration, product setting, service restart, qualification
declaration or signed physical Forget claim. Record actual results here before
marking hosted acceptance deployed.
