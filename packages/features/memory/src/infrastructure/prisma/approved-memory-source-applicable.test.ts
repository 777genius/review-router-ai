import { describe, expect, it } from "vitest";
import type { MemoryKnowledgeSource } from "../../domain/memory-knowledge";
import { approvedMemorySourceApplicable } from "./approved-memory-source-applicable";
const source: MemoryKnowledgeSource = {
  type: "github_comment",
  sourceId: "github-node:IC_kwDOABCD123",
  revision: "2026-10-19T10:00:00Z",
  updatedAt: "2026-10-19T10:00:00Z",
  statementAt: "2026-10-18T10:00:00Z",
  repositoryId: "repo_1",
  pullRequestNumber: 12,
  url: "https://github.com/acme/project/pull/12#issuecomment-1",
  visibility: "public",
  claimedBodyDigest: null,
  observedCommitSha: null,
};
const input = {
  actor: {
    kind: "workspace_user" as const,
    id: "user_1",
    githubUserId: null,
    login: null,
  },
  scope: {
    kind: "repository" as const,
    workspaceId: "workspace_1",
    repositoryId: "repo_1",
  },
  source,
  consumer: "management" as const,
};
const controls = () => ({ deadlineAt: new Date(Date.now() + 5_000) });
describe("approved source applicability", () => {
  it("keeps approved canonical provenance readable without source I/O or freshness lookups", async () => {
    expect(await approvedMemorySourceApplicable(input, controls())).toBe(true);
    expect(
      await approvedMemorySourceApplicable(
        { ...input, source: { ...source, updatedAt: "2020-01-01T00:00:00Z" } },
        controls(),
      ),
    ).toBe(true);
  });
  it.each([
    { sourceId: "github-comment:123" },
    { repositoryId: "other_repo" },
    { url: "javascript:alert(1)" },
    { url: "https://github.com.evil.test/acme/project/pull/12" },
    { url: "https://github.com/acme/project/pull/13" },
    { statementAt: "not a time" },
    { type: "migration" as const },
  ])("denies unqualified stored metadata %o", async (change) => {
    expect(
      await approvedMemorySourceApplicable(
        { ...input, source: { ...source, ...change } },
        controls(),
      ),
    ).toBe(false);
  });
  it("does not expose private links through workspace promotion", async () => {
    const scoped = {
      ...input,
      scope: { kind: "workspace" as const, workspaceId: "workspace_1" },
      source: { ...source, visibility: "private" as const },
    };
    expect(await approvedMemorySourceApplicable(scoped, controls())).toBe(
      false,
    );
    expect(
      await approvedMemorySourceApplicable(
        { ...scoped, source: { ...scoped.source, url: null } },
        controls(),
      ),
    ).toBe(true);
  });
  it("keeps at-commit observations historical in management and exact-head only at runtime", async () => {
    const observed = {
      ...input,
      source: { ...source, observedCommitSha: "a".repeat(40) },
    };
    expect(await approvedMemorySourceApplicable(observed, controls())).toBe(
      true,
    );
    expect(
      await approvedMemorySourceApplicable(
        { ...observed, consumer: "runtime", headSha: "b".repeat(40) },
        controls(),
      ),
    ).toBe(false);
    expect(
      await approvedMemorySourceApplicable(
        { ...observed, consumer: "runtime", headSha: "a".repeat(40) },
        controls(),
      ),
    ).toBe(true);
  });
  it("honors cancellation and deadlines", async () => {
    expect(
      await approvedMemorySourceApplicable(input, { deadlineAt: new Date(0) }),
    ).toBe(false);
    expect(
      await approvedMemorySourceApplicable(input, {
        deadlineAt: new Date(Date.now() + 100),
        signal: AbortSignal.abort(),
      }),
    ).toBe(false);
  });
});
