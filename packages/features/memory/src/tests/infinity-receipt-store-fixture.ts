import type { MemoryIndexDocument } from "../application/ports/memory-search-index-port";
import type {
  MemoryProjectionReceipt,
  MemoryProjectionReceiptStore,
} from "../infrastructure/projection/memory-projection-receipt-store";

/** Test double for metadata persistence; actual SQL fences are qualified separately. */
export class InfinityReceiptStoreFixture implements MemoryProjectionReceiptStore {
  readonly canonical = new Map<string, MemoryIndexDocument>();
  readonly rows = new Map<string, MemoryProjectionReceipt>();
  readonly deferred: {
    readonly receiptId: string;
    readonly reasonCode: string;
  }[] = [];
  readonly retired = new Set<string>();
  readonly dueAt = new Map<string, Date>();
  beforeAdmission: (() => Promise<void>) | undefined;
  coverageOverride: boolean | undefined;
  private sequence = 0;

  putCanonical(document: MemoryIndexDocument): void {
    this.canonical.set(document.memoryItemId, document);
  }

  currentRow(id: string): MemoryProjectionReceipt {
    const row = this.rows.get(id);
    if (row === undefined) throw new Error("fixture_receipt_missing");
    const document = this.canonical.get(row.memoryItemId);
    return {
      ...row,
      isCurrent:
        document !== undefined &&
        document.workspaceId === row.workspaceId &&
        document.repositoryId === row.repositoryId &&
        document.userId === row.userId &&
        document.scope === row.scope &&
        document.bodyVersion === row.bodyVersion &&
        document.bodyHash === row.bodyHash,
    };
  }

  makeAllDue(): void {
    this.dueAt.clear();
  }

  async assertCompatibleIndexIdentity(indexIdentity: string): Promise<void> {
    if (this.retired.has(indexIdentity))
      throw new Error("memory_index_generation_retired");
    if (
      [...this.rows.values()].some(
        (row) => row.indexIdentity !== indexIdentity && row.state !== "deleted",
      )
    ) {
      throw new Error("memory_index_identity_conflict");
    }
  }

  async retireIndexIdentity(indexIdentity: string): Promise<void> {
    if ((await this.listOutstanding({ indexIdentity, limit: 1 })).length > 0) {
      throw new Error("memory_index_outstanding_debt");
    }
    this.retired.add(indexIdentity);
  }

  async reserve(
    input: Parameters<MemoryProjectionReceiptStore["reserve"]>[0],
  ): Promise<MemoryProjectionReceipt | null> {
    await this.assertCompatibleIndexIdentity(input.indexIdentity);
    const previous = [...this.rows.values()].find(
      (row) =>
        row.indexIdentity === input.indexIdentity &&
        row.workspaceId === input.workspaceId &&
        row.memoryItemId === input.memoryItemId &&
        row.bodyVersion === input.bodyVersion &&
        row.bodyHash === input.bodyHash,
    );
    if (previous !== undefined) return this.currentRow(previous.id);
    const row: MemoryProjectionReceipt = {
      ...input,
      id: `receipt_${++this.sequence}`,
      sequenceOrdinal: this.sequence,
      state: "reserved",
      remoteDocumentId: null,
      deleteRequested: false,
      isCurrent: false,
    };
    this.rows.set(row.id, row);
    if (!this.currentRow(row.id).isCurrent) {
      this.rows.delete(row.id);
      return null;
    }
    return this.currentRow(row.id);
  }

  async admitSend(
    input: Parameters<MemoryProjectionReceiptStore["admitSend"]>[0],
  ): Promise<MemoryProjectionReceipt | null> {
    await this.beforeAdmission?.();
    await this.assertCompatibleIndexIdentity(input.indexIdentity);
    const row = this.currentRow(input.receiptId);
    if (!row.isCurrent || row.deleteRequested || row.state === "deleted")
      return null;
    this.rows.set(row.id, { ...row, state: "sent_unknown" });
    return this.currentRow(row.id);
  }

  async recordAcknowledgement(
    input: Parameters<MemoryProjectionReceiptStore["recordAcknowledgement"]>[0],
  ): Promise<MemoryProjectionReceipt> {
    const row = this.currentRow(input.receiptId);
    if (
      row.remoteDocumentId !== null &&
      row.remoteDocumentId !== input.remoteDocumentId
    ) {
      throw new Error("memory_index_receipt_conflict");
    }
    this.rows.set(row.id, {
      ...row,
      remoteDocumentId: input.remoteDocumentId,
      state:
        row.state === "indexed" || row.state === "deleted"
          ? row.state
          : "accepted",
    });
    return this.currentRow(row.id);
  }

  async markIndexed(
    input: Parameters<MemoryProjectionReceiptStore["markIndexed"]>[0],
  ): Promise<MemoryProjectionReceipt> {
    const row = this.currentRow(input.receiptId);
    if (row.remoteDocumentId !== input.remoteDocumentId)
      throw new Error("memory_index_receipt_conflict");
    if (row.isCurrent && !row.deleteRequested && row.state !== "deleted") {
      this.rows.set(row.id, { ...row, state: "indexed" });
    }
    return this.currentRow(row.id);
  }

  async findByReceiptIds(
    input: Parameters<MemoryProjectionReceiptStore["findByReceiptIds"]>[0],
  ): Promise<readonly MemoryProjectionReceipt[]> {
    return input.receiptIds.flatMap((id) => {
      const row = this.rows.get(id);
      return row !== undefined && row.indexIdentity === input.indexIdentity
        ? [this.currentRow(id)]
        : [];
    });
  }

  async hasCoverage(
    input: Parameters<MemoryProjectionReceiptStore["hasCoverage"]>[0],
  ): Promise<boolean> {
    if (this.coverageOverride !== undefined) return this.coverageOverride;
    const scope = input.scope;
    return [...this.canonical.values()]
      .filter(
        (document) =>
          document.workspaceId === scope.workspaceId &&
          scope.allowedScopes.includes(document.scope),
      )
      .filter(
        (document) =>
          document.scope !== "repository" ||
          document.repositoryId === scope.repositoryId,
      )
      .filter(
        (document) =>
          document.scope !== "user_prefs" ||
          (scope.includeUserPrefs && document.userId === scope.userId),
      )
      .every((document) =>
        [...this.rows.values()].some(
          (row) =>
            row.indexIdentity === input.indexIdentity &&
            row.memoryItemId === document.memoryItemId &&
            row.state === "indexed" &&
            !row.deleteRequested &&
            this.currentRow(row.id).isCurrent,
        ),
      );
  }

  async requestDeletion(
    input: Parameters<MemoryProjectionReceiptStore["requestDeletion"]>[0],
  ): Promise<void> {
    for (const row of this.rows.values()) {
      if (!matchesDeletion(row, input) || row.state === "deleted") continue;
      if (!row.deleteRequested) this.dueAt.set(row.id, new Date());
      this.rows.set(row.id, {
        ...row,
        deleteRequested: true,
        state: row.state === "reserved" ? "deleted" : row.state,
      });
    }
  }

  async listForDeletion(
    input: Parameters<MemoryProjectionReceiptStore["listForDeletion"]>[0],
  ): Promise<readonly MemoryProjectionReceipt[]> {
    return this.orderedReceipts()
      .filter(
        (row) =>
          matchesDeletion(row, input) &&
          row.deleteRequested &&
          row.state !== "deleted",
      )
      .slice(0, input.limit)
      .map((row) => this.currentRow(row.id));
  }

  async listDue(
    input: Parameters<MemoryProjectionReceiptStore["listDue"]>[0],
  ): Promise<readonly MemoryProjectionReceipt[]> {
    return this.orderedReceipts()
      .filter(
        (row) =>
          row.indexIdentity === input.indexIdentity && row.state !== "deleted",
      )
      .map((row) => this.currentRow(row.id))
      .filter(
        (row) =>
          row.state !== "indexed" || row.deleteRequested || !row.isCurrent,
      )
      .filter(
        (row) =>
          (this.dueAt.get(row.id)?.getTime() ?? 0) <= input.now.getTime(),
      )
      .slice(0, input.limit);
  }

  async listOutstanding(
    input: Parameters<MemoryProjectionReceiptStore["listOutstanding"]>[0],
  ): Promise<readonly MemoryProjectionReceipt[]> {
    return this.orderedReceipts()
      .filter(
        (row) =>
          row.indexIdentity === input.indexIdentity && row.state !== "deleted",
      )
      .slice(0, input.limit)
      .map((row) => this.currentRow(row.id));
  }

  private orderedReceipts(): MemoryProjectionReceipt[] {
    return [...this.rows.values()].sort(
      (left, right) =>
        (this.dueAt.get(left.id)?.getTime() ?? 0) -
          (this.dueAt.get(right.id)?.getTime() ?? 0) ||
        left.sequenceOrdinal - right.sequenceOrdinal,
    );
  }

  async markDeleted(
    input: Parameters<MemoryProjectionReceiptStore["markDeleted"]>[0],
  ): Promise<void> {
    const row = this.currentRow(input.receiptId);
    if (
      !row.deleteRequested ||
      row.remoteDocumentId !== input.remoteDocumentId
    ) {
      throw new Error("memory_index_deletion_evidence_invalid");
    }
    this.rows.set(row.id, { ...row, state: "deleted" });
  }

  async defer(
    input: Parameters<MemoryProjectionReceiptStore["defer"]>[0],
  ): Promise<void> {
    this.deferred.push({
      receiptId: input.receiptId,
      reasonCode: input.reasonCode,
    });
    this.dueAt.set(input.receiptId, input.nextAttemptAt);
  }
}

function matchesDeletion(
  row: MemoryProjectionReceipt,
  input: Parameters<MemoryProjectionReceiptStore["requestDeletion"]>[0],
): boolean {
  return (
    row.indexIdentity === input.indexIdentity &&
    row.workspaceId === input.workspaceId &&
    row.memoryItemId === input.memoryItemId &&
    (input.target.kind === "item" ||
      (row.bodyVersion === input.target.bodyVersion &&
        row.bodyHash === input.target.bodyHash))
  );
}
