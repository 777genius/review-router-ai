# Review settings and Codex reconnect

[Back to README](../README.md)

## Team and repository settings

Use the dashboard for workspace defaults and repository overrides: providers,
models, reasoning effort, review language, severity thresholds, comment limits,
provider parallelism and the agreement required for inline findings.
Provider capabilities differ; not every model supports every setting.

Operators can also use the [configuration CLI](./operations/review-configuration-operator-cli.md):

```bash
reviewrouter config get --repo OWNER/REPOSITORY
reviewrouter config set --repo OWNER/REPOSITORY --effort xhigh
```

## GitHub workflow controls

For generated GitHub workflows, repository variables control draft review,
timeout and PR size without another setup PR:

```bash
gh variable set REVIEW_ROUTER_REVIEW_DRAFTS --repo OWNER/REPOSITORY --body true
gh variable set REVIEW_ROUTER_TIMEOUT_MINUTES --repo OWNER/REPOSITORY --body 180
gh variable set REVIEW_ROUTER_MAX_CHANGED_LINES --repo OWNER/REPOSITORY --body 10000
```

- Only the exact draft value `true` enables draft review. Fork and bot PRs
  remain excluded by the generated workflow.
- Client-triggered T0 schema 3 defaults to 240 minutes for review and publication;
  older schema 1 and 2 workflows retain their 60-minute fallback. The override
  accepts integers from 10 to 360. Check your generated workflow for its default.
- The size limit counts additions plus deletions. Empty, unset or `0` disables
  it. With a limit enabled, an unavailable changed-line count blocks the review.

Use `gh variable delete VARIABLE_NAME --repo OWNER/REPOSITORY` to restore a default.

## Reconnect repository-scoped Codex OAuth

In **Dashboard > Enable review > Codex**, select the repository and request a
fresh or recovery setup command. Run the complete generated command on your
trusted machine. It pins and verifies the installer before executing it.
Do not substitute a `curl | bash` command or an installer from a moving branch.

Alternatively, from this repository:

```bash
bash scripts/reseed-codex-rotating-auth.sh --repo OWNER/REPOSITORY
```

The helper requests the current setup command. Fresh login uses a dedicated
ReviewRouter Codex home. Follow that flow to upload and confirm the current
credential generation; do not manually overwrite a guessed GitHub secret name.
Current rotating auth uses server-authorized secret namespaces.

If a run reports `refresh token was already used`, perform a fresh reconnect.
Use `--reuse-current-auth` only immediately after creating a known-current session
in the dedicated home. A provider quota failure requires available capacity;
reconnecting alone does not restore quota.

Running and completed jobs do not receive updated secrets. Once reconnect is
confirmed, rerun failed jobs only if the PR head is unchanged:

```bash
gh run rerun RUN_ID --repo OWNER/REPOSITORY --failed
```

If the head changed, use the new PR run. Reconnecting does not update the
workflow's pinned Action version.

Hosted pool accounts use a different lifecycle. Follow the
[pool operator guide](../ai-docs/operations/hosted-pool-operator.md).
