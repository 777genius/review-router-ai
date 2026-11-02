import assert from "node:assert/strict";
import type { MemoryKnowledgeOperation } from "../../packages/features/memory/src/index.js";

/** Drive only known pending work; an existing live worker lease is only awaited. */
export async function settleMemoryCommand(input: {
  progress(): Promise<MemoryKnowledgeOperation>;
  deliver(): Promise<unknown>;
  hasLiveClaim(): Promise<boolean>;
  accepted: readonly MemoryKnowledgeOperation["state"][];
  deadlineAt: Date;
  pause?: () => Promise<void>;
}): Promise<MemoryKnowledgeOperation> {
  const pause =
    input.pause ?? (() => new Promise((done) => setTimeout(done, 500)));
  for (;;) {
    const operation = await input.progress();
    if (input.accepted.includes(operation.state)) return operation;
    assert(
      Date.now() < input.deadlineAt.getTime(),
      "native_memory_operation_deadline",
    );
    if (operation.state === "unknown") {
      assert(await input.hasLiveClaim(), "native_memory_operation_unsettled");
    } else {
      assert(
        ["queued", "submitted", "processing"].includes(operation.state),
        "native_memory_operation_unsettled",
      );
      await input.deliver();
    }
    await pause();
  }
}
