# Account Gateway integration stack

Owner decision: 2026-10-03. This branch is the integration base for the plan51/contract53 program.
The root PR targets main and stays draft until assembled qualification.
Component PRs target feat/account-gateway-integration or an explicit parent
component. Review each bounded diff; integrate accepted components through
GitHub PRs, retain their commits/issue refs, and run final assembled E2E on an
exact SHA before the root PR is ready. No deployment or legacy retirement is
implied by integration.

## Current release pairing - 2026-10-11

Integration PR548 merged the five CI pair fields to published Action `v1.0.158`
at `4cb00b4598974bc8fb5feafc1b1699ca76ca32af` / public bundle SHA256
`166ab590292c76ea78b2015dfda71aacf91be963b0b94f7c04f9c7883c18a814`.
Normal Action release run `38128645739` and paired control plane CI `38129571872`
succeeded. [Evidence52](../architecture/52-account-gateway-first-slice-contract.md)
retains the bounded MiMo D-long and current OpenRouter E receipts, historical
unknown outcomes and their exact source tuples. Final assembled ROOT/main CI,
matching control plane release, protected OAuth F and production G remain separate gates;
no production deployment or legacy retirement is asserted here. The RAM lane
is stopped under the recorded execution policy; failed/unqualified evidence stays.

## Current and next components

- Plan corrections after Opus 5.5/xhigh critique, including all finding dispositions.
- RR C1 owner/use persistence: preserve existing PR 488 and its review history;
  qualify migration 117 catalog, reconcile this base, then retarget to this branch.
- RR C2 server gateway adapter/configuration/OIDC relay.
- RR C3 Accounts UI and Models/repository batch policy.
- D-min real Codex/MiMo CLI tools/final review/publication; then D-final lifecycle
  and measured enforced limits. UI may proceed in parallel with D-min.

## Service repositories

GitHub PR bases are repository-local. The reusable service and pinned native
fork keep their own component PRs linked from the root PR rather than copied
into RR. The root candidate selects only accepted service/SDK/engine source.

- Native `agent-teams-ai/sub2api` PR33 merged normally as
  `135fd7dee9ab1d93552709a05805d01867ce3c0b`; reviewed source
  `3d3ea7a40a2bff649a241025a935f8136fa9fe5e`, tree
  `8d21f751f7c171c8520a263898657f726a0cd5ec`, CI `38132249332` PASS.
  The source-clean VCS-built ELF SHA256 is
  `a3e32dc4f3c6f7988ddbd9fdb125d5227e91474c61941dad4466fe83826db119`.
- Gateway merged source `16e1cc992e0447040faa6fbb4354a85c5000efbf`, reviewed
  fixture correction `d73861a85e2a581b4006738a085036219a62af53`, tree
  `f626d443cad48426cf3acd63fb0c12a2f93bc311`, CI `38131753903` and
  `38131753934` PASS. Production service/SDK source is unchanged from accepted
  `c598146dfc63113635e4bfd6efd8df7cd10fe127`.

These are exact source/artifact selections. Fixed OAuth runtime recovery
remains pending after an observed start failure; the cutover outcome is UNKNOWN.
Source CI does not claim F runtime readiness or production G installation/custody. Historical D/E receipts retain their original native
pins and must not be rewritten to the newer source.

## Rules

Default tier only; explicit gpt-6.1-sol/high/default writers and gpt-6.1-sol/xhigh/default independent
reviews. Separate hosted jobs/workspaces and non-overlapping ownership.
Target <=2000 changed LOC per component; preserve existing coherent larger PRs.
All ordinary commits: iliya <iliyazelenkog@gmail.com>, conventional messages,
Refs agent-teams-ai/account-gateway#1. Tests only disposable sandbox projects.
Unknown effects and cleanup evidence survive rollback; disable new admission
before reverting. Do not revive legacy grants/refresh writers automatically.

The normative contract is [architecture/53-account-gateway-implementation-contract.md](../architecture/53-account-gateway-implementation-contract.md);
architecture/51 defines the full program and architecture/50 the owner vision.
Opus dispositions are accepted at DOC PLAN level in 52; 53 is included with exact
bytes/digest in every packet. Documentation or terminal catalog status does not close a runtime gate.
W5/C1 catalog outputs are terminal awaiting qualification; B2 remains active elsewhere.
This docs worker does not open/commit/push: main verifies owner identities and
opens its child PR targeting feat/account-gateway-integration under root PR490.
Supplied base d06564b4 is not an observed HEAD when linked Git metadata is unavailable.
S operator grants follow D, E/F remain mandatory before G, H preserves personal sharing.
