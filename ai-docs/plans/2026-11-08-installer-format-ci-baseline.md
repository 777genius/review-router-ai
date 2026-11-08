# Restore installer formatting CI baseline

The merged agent-mode installer change left two existing TypeScript files failing `pnpm format:check` on new conversation feature PRs. This is an independent CI issue, not part of `/rr fixed` or `/rr suggest fix`.

## Scope

- Only `deploy/self-hosted/install.ts` and `deploy/self-hosted/install-agent.test.ts` receive Prettier 3.8.3 formatting.
- No change to installer semantics, secrets, approval flow, schema or runtime.
- Verify `pnpm exec prettier --check` then full Static Checks.
- This small baseline PR can merge before the two feature PRs; do not weaken CI.
