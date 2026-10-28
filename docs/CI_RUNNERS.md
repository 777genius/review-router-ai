# Linux CI runners

Trusted Linux CI jobs use the repository variable `CI_LINUX_RUNNER`, configured
as `nscloud-ubuntu-24.04-amd64-4x8` (Ubuntu 24.04, x86-64, 4 vCPU, 8 GB RAM).
Namespace GitHub Actions is already enabled for the account repositories.
The workspace shares 32 Linux vCPU / 64 GB RAM, allowing eight such jobs at once.
Heavy web and OCI builds use `CI_LINUX_BUILD_RUNNER`, configured as
`nscloud-ubuntu-24.04-amd64-4x16`. Their Next.js builds exceeded Node's
automatic ~2 GB heap limit on an 8 GB runner. The 16 GB shape retains build
behavior and gives Node the larger automatic heap. Build jobs fall back to
`CI_LINUX_RUNNER` when the dedicated variable is unset. Mixed shapes share
the same workspace CPU and memory limits.

Matrix OS names remain unchanged: only Linux execution is routed. Native macOS
and Windows jobs keep their existing runners. Pull requests from forks keep
GitHub-hosted runners rather than running untrusted code on the managed pool.
Unset variables fall back to the original GitHub Ubuntu labels.

Where required, `CI_LINUX_ARM_RUNNER` selects
`nscloud-ubuntu-24.04-arm64-4x8`, and `CI_LINUX_2204_RUNNER` selects
`nscloud-ubuntu-22.04-amd64-4x8`. Do not route an ARM matrix leg to x86-64.
Dedicated private-network runners and deployment procedures are outside this
migration. Release jobs use the separate `CI_RELEASE_LINUX_RUNNER`
setting, which defaults to their original GitHub-hosted `ubuntu-latest` runner.
CI pool changes must not move the release attestation signer. Frozen VS Code workflows are unchanged.

To verify execution, inspect the job's labels and runner name in GitHub Actions
and the corresponding job in Namespace. A queued job alone is not proof of a
working runner. Validate an actual CI job to completion before declaring rollout
complete. Existing queued jobs retain their old routing; rerun only the current
required work after the workflow change reaches its branch. Preserve completed
checks and avoid duplicating active runs.

Rollback: set `CI_LINUX_RUNNER` to the prior provider (`ubuntu-latest` for
review-router-ai, `ubicloud-standard-4` for universal-agent-plugins), or unset it
to restore each workflow's original GitHub-hosted label. Restore any architecture
specific overrides separately. No source or test logic changes are needed.
