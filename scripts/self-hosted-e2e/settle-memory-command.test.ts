import assert from "node:assert/strict";
import { test } from "node:test";
import { settleMemoryCommand } from "./settle-memory-command.ts";
import type { MemoryKnowledgeOperation } from "../../packages/features/memory/src/index.js";
const operation = (
  state: MemoryKnowledgeOperation["state"],
): MemoryKnowledgeOperation => ({
  id: "command",
  ref: {
    type: "entry",
    entryId: "entry",
    scope: { kind: "workspace", workspaceId: "workspace" },
  },
  revision: "1",
  state,
});
const base = {
  accepted: ["published"] as const,
  deadlineAt: new Date(Date.now() + 30_000),
  pause: async () => {},
  hasLiveClaim: async () => false,
};
test("already published by Compose worker returns without another delivery", async () => {
  let deliveries = 0;
  const result = await settleMemoryCommand({
    ...base,
    progress: async () => operation("published"),
    deliver: async () => {
      deliveries++;
    },
  });
  assert.equal(result.state, "published");
  assert.equal(deliveries, 0);
});
test("only pending work delivers, then actual terminal readback is returned", async () => {
  let deliveries = 0;
  await settleMemoryCommand({
    ...base,
    progress: async () => operation(deliveries ? "published" : "queued"),
    deliver: async () => {
      deliveries++;
    },
  });
  assert.equal(deliveries, 1);
});
test("unknown without live lease and failed work refuse before any delivery", async () => {
  for (const state of ["unknown", "failed"] as const) {
    let deliveries = 0;
    await assert.rejects(
      settleMemoryCommand({
        ...base,
        progress: async () => operation(state),
        deliver: async () => {
          deliveries++;
        },
      }),
    );
    assert.equal(deliveries, 0);
  }
});
test("in-flight worker unknown is awaited without sending a replacement", async () => {
  let advanced = false;
  let deliveries = 0;
  await settleMemoryCommand({
    ...base,
    hasLiveClaim: async () => true,
    progress: async () => operation(advanced ? "published" : "unknown"),
    pause: async () => {
      advanced = true;
    },
    deliver: async () => {
      deliveries++;
    },
  });
  assert.equal(deliveries, 0);
});
