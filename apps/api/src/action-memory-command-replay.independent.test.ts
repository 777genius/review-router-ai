import { describe, expect, it, vi } from "vitest";
import type {
  MemoryEntryRef,
  MemoryKnowledgeSource,
  MemoryKnowledgeStore,
  MemoryStoredCommand,
} from "@reviewrouter/features-memory";
import {
  originalActionMemoryRevision,
  prepareActionMemoryCommand,
} from "./action-memory-command-replay";

const actor = {
  kind: "github_user" as const,
  id: "github-user:11",
  githubUserId: "11",
  login: "maintainer",
};
const ref: MemoryEntryRef = {
  type: "entry",
  scope: {
    kind: "repository",
    workspaceId: "workspace_1",
    repositoryId: "repo_1",
  },
  entryId: "mem_existing",
};
const source: MemoryKnowledgeSource = {
  type: "github_comment",
  sourceId: "github-node:IC_fixture_77",
  repositoryId: "repo_1",
  revision: "2026-10-23T10:00:00.000Z",
  updatedAt: "2026-10-23T10:00:00.000Z",
  statementAt: "2026-10-23T10:00:00.000Z",
  pullRequestNumber: 7,
  url: "https://github.com/acme/project/pull/7#issuecomment-77",
  visibility: "private",
  claimedBodyDigest: "a".repeat(64),
  observedCommitSha: null,
};
const commandId = "123e4567-e89b-42d3-a456-426614174000";
const wire = {
  kind: "update_memory",
  commandId,
  memoryItemId: ref.entryId,
  expectedRevision: "17",
  body: "Use UTC for stored times.",
};
function fixture() {
  const findCommand = vi.fn(
    async (): Promise<MemoryStoredCommand | null> => null,
  );
  const input = {
    store: { findCommand } as unknown as MemoryKnowledgeStore,
    actor,
    ref,
    source,
    commandId,
    expectedRevision: "17",
    wire,
    generation: "generation_1",
    now: new Date("2026-10-23T10:00:00Z"),
  };
  return { findCommand, input };
}
async function admitted(
  f: ReturnType<typeof fixture>,
  state: MemoryStoredCommand["operation"]["state"] = "published",
) {
  const first = await prepareActionMemoryCommand(f.input);
  const stored: MemoryStoredCommand = {
    operation: { id: commandId, ref, revision: "18", state },
    digest: "b".repeat(64),
    envelope: null,
    contentApprovalRevision: "18",
    originalStatementAt: source.statementAt,
    deliveryExpiresAt: "2026-10-23T11:00:00Z",
    resubmitUntil: "2026-10-23T10:15:00Z",
    approval: first.approval,
  };
  f.findCommand.mockResolvedValue(stored);
  return stored;
}
describe("independent Action memory replay critic", () => {
  it.each(["queued", "published", "completed", "cleanup_pending"] as const)(
    "restores original CAS and approval from purged metadata in state %s",
    async (state) => {
      const f = fixture();
      const stored = await admitted(f, state);
      const retry = await prepareActionMemoryCommand({
        ...f.input,
        now: new Date("2026-10-24T10:00:00Z"),
      });
      expect(retry.replay).toBe(stored.operation);
      expect(retry.approval).toBe(stored.approval);
      expect(originalActionMemoryRevision(stored, actor, ref)).toBe("17");
      expect(f.findCommand).toHaveBeenCalledWith({
        commandId,
        generation: "generation_1",
        scope: ref.scope,
      });
      expect(stored.approval.authorityRevision).not.toContain(wire.body);
    },
  );
  it("does not borrow a later revision after unrelated body or topic updates", async () => {
    const f = fixture();
    const stored = await admitted(f);
    expect(
      originalActionMemoryRevision(
        { ...stored, operation: { ...stored.operation, revision: "999" } },
        actor,
        ref,
      ),
    ).toBe("17");
    expect((await prepareActionMemoryCommand(f.input)).replay?.revision).toBe(
      "18",
    );
  });
  it.each([
    { wire: { ...wire, body: "Use local timestamps instead." } },
    { wire: { ...wire, kind: "forget_memory" } },
    { expectedRevision: "18" },
    { source: { ...source, revision: "2026-10-23T10:01:00Z" } },
    { source: { ...source, sourceId: "github-node:IC_other" } },
    { actor: { ...actor, githubUserId: "22" } },
    { actor: { ...actor, id: "github-user:22" } },
    { ref: { ...ref, entryId: "mem_other" } },
    {
      ref: { ...ref, scope: { ...ref.scope, workspaceId: "workspace_other" } },
    },
  ])(
    "rejects a changed request/actor/source/target under the same UUID: %o",
    async (change) => {
      const f = fixture();
      await admitted(f);
      await expect(
        prepareActionMemoryCommand({ ...f.input, ...change }),
      ).rejects.toMatchObject({ code: "conflict" });
    },
  );
  it("does not use a display login as stable actor identity or permit another actor's detail lookup", async () => {
    const f = fixture();
    const stored = await admitted(f);
    expect(() =>
      originalActionMemoryRevision(
        stored,
        { ...actor, kind: "workspace_user" },
        ref,
      ),
    ).toThrow("memory_conflict");
    expect(() =>
      originalActionMemoryRevision(
        stored,
        { ...actor, githubUserId: "22" },
        ref,
      ),
    ).toThrow("memory_conflict");
    const retry = await prepareActionMemoryCommand({
      ...f.input,
      actor: { ...actor, login: "renamed-maintainer" },
    });
    expect(retry.replay).toBe(stored.operation);
  });
});
