# Provider API Key Workspace Access

## Policy

MiMo provider API key management is default-deny. Enable it only for an explicitly selected synthetic or disposable test workspace. This command grants only the exact workspace ID; it does not grant sibling workspaces or imply account or organization access. Any account or organization grant requires its own explicit audited operator path and remains default-deny. OpenRouter is not gated by this MiMo grant.

Workspace administrators cannot grant themselves access through the public API. This is a trusted operator-only path and must not be exposed as a public mutation.

## Safety Boundary

- Use only a disposable test workspace, never a live customer or user project.
- Supply the exact workspace ID, a non-secret operator actor, and a ticket or test-purpose reason.
- Inspect first, use `--dry-run` for a write plan, and require `--confirm` for a real write.
- The command reads the workspace and current grant before mutation and rejects missing, ambiguous, or mismatched targets.
- Grant writes persist the operator actor in `grantedBy` and the non-secret purpose in `grantReason`.
- Revocation deletes only the observed grant ID paired with the exact workspace ID and fails if that target changes.
- Output contains grant status and audit metadata only. It does not query, read, or print provider API keys or a database URL.
- Do not pass a database URL on the command line. The command uses the existing Prisma 7 adapter and normal database environment configuration.

## Test Workspace Procedure

Inspect the exact target:

```sh
pnpm exec tsx scripts/provider-api-key-workspace-access.ts inspect \
  --workspace-id WORKSPACE_ID \
  --actor OPERATOR_ID \
  --reason "Disposable synthetic test workspace"
```

Preview and then grant access:

```sh
pnpm exec tsx scripts/provider-api-key-workspace-access.ts grant \
  --workspace-id WORKSPACE_ID \
  --actor OPERATOR_ID \
  --reason "Disposable synthetic test workspace" \
  --dry-run

pnpm exec tsx scripts/provider-api-key-workspace-access.ts grant \
  --workspace-id WORKSPACE_ID \
  --actor OPERATOR_ID \
  --reason "Disposable synthetic test workspace" \
  --confirm
```

Preview and then revoke access when the test batch finishes:

```sh
pnpm exec tsx scripts/provider-api-key-workspace-access.ts revoke \
  --workspace-id WORKSPACE_ID \
  --actor OPERATOR_ID \
  --reason "Disposable synthetic test cleanup" \
  --dry-run

pnpm exec tsx scripts/provider-api-key-workspace-access.ts revoke \
  --workspace-id WORKSPACE_ID \
  --actor OPERATOR_ID \
  --reason "Disposable synthetic test cleanup" \
  --confirm
```

Run `inspect` again to verify the final default-deny state. Keep operator logs with the actor and reason for the write audit; these fields must contain no credentials.
