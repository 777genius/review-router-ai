# Linux CI runners

Trusted Linux CI jobs use the repository variable `CI_LINUX_CHECKS_RUNNER`, configured
as `nscloud-ubuntu-24.04-amd64-4x8` (Ubuntu 24.04, x86-64, 4 vCPU, 8 GB RAM).
Namespace GitHub Actions is already enabled for the account repositories.
The workspace shares 32 Linux vCPU / 64 GB RAM, allowing eight such jobs at once.
Heavy web and OCI builds use `CI_LINUX_BUILD_RUNNER`, configured as
`nscloud-ubuntu-24.04-amd64-4x16`. Their Next.js builds exceeded Node's
automatic ~2 GB heap limit on an 8 GB runner. The 16 GB shape retains build
behavior and gives Node the larger automatic heap. Build jobs fall back to
`CI_LINUX_CHECKS_RUNNER` when the dedicated variable is unset. The legacy
`CI_LINUX_RUNNER` remains a final fallback for existing configurations. Mixed shapes share
the same workspace CPU and memory limits.

Matrix OS names remain unchanged: only Linux execution is routed. Native macOS
and Windows jobs keep their existing runners. Pull requests from forks keep
GitHub-hosted runners rather than running untrusted code on the managed pool.
Unset variables fall back to the original GitHub Ubuntu labels.

Dedicated private-network runners and deployment procedures are outside this
migration. Release jobs use the separate `CI_RELEASE_LINUX_RUNNER`
setting, which defaults to their original GitHub-hosted `ubuntu-latest` runner.
CI pool changes must not move the release attestation signer.

To verify execution, inspect the job's labels and runner name in GitHub Actions
and the corresponding job in Namespace. A queued job alone is not proof of a
working runner. Validate an actual CI job to completion before declaring rollout
complete. Existing queued jobs retain their old routing; rerun only the current
required work after the workflow change reaches its branch. Preserve completed
checks and avoid duplicating active runs.

The checks override allows a staged rollout while the current main still uses
the legacy variable for release jobs. Keep `CI_LINUX_RUNNER=ubuntu-latest`;
changing the checks pool must not change old release workflows.

Rollback: unset both `CI_LINUX_CHECKS_RUNNER` and `CI_LINUX_BUILD_RUNNER` while
keeping `CI_LINUX_RUNNER=ubuntu-latest`, or set both overrides to the desired
GitHub-hosted runner. No source or test logic changes are needed.
