import { AuthorityError } from "../domain/contracts.js";
import type {
  CurrentAuthoritySnapshot,
  CurrentAuthoritySnapshotPort,
  AuthorityLedger,
  AuthorityScope,
  ReceiptRepositoryPort,
  ReceiptSelection,
} from "../application/ports.js";

/** Conformance adapter only. Production composition must supply durable serializable storage. */
export class InMemoryReceiptRepository implements ReceiptRepositoryPort {
  private readonly ledgers = new Map<string, AuthorityLedger>();
  private readonly tails = new Map<string, Promise<void>>();

  async transact<T>(
    scope: AuthorityScope,
    selection: ReceiptSelection,
    operation: (ledger: AuthorityLedger) => Promise<T>,
  ): Promise<T> {
    const selected = structuredClone(selection);
    const key = JSON.stringify([
      scope.tenantId,
      scope.repositoryId,
      scope.pullRequest,
    ]);
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(key, tail);
    await previous;
    try {
      const stored = structuredClone(
        this.ledgers.get(key) ?? { fence: 0, records: [] },
      );
      const matches = (record: AuthorityLedger["records"][number]) =>
        "requestId" in selected
          ? record.grant.request.requestId === selected.requestId
          : record.grant.grantId === selected.grantId;
      const draft = {
        fence: stored.fence,
        records: stored.records.filter(matches),
      };
      const result = await operation(draft);
      const output = structuredClone(result);
      this.ledgers.set(
        key,
        structuredClone({
          fence: draft.fence,
          records: [
            ...stored.records.filter((record) => !matches(record)),
            ...draft.records,
          ],
        }),
      );
      return output;
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

/** Test-only epoch fence. Every replacement (including revocation and restoration)
 * advances the epoch. The hook deterministically pauses resolution after capture.
 * Production adapters must fence ALL authority writers across processes. */
export class InMemoryCurrentAuthoritySnapshot implements CurrentAuthoritySnapshotPort {
  private epoch: number;
  private current: CurrentAuthoritySnapshot | null;

  constructor(
    snapshot:
      | (Omit<CurrentAuthoritySnapshot, "epoch"> & {
          readonly epoch?: number;
        })
      | null,
    private readonly afterCapture: () => Promise<void> = async () => {},
  ) {
    this.epoch = snapshot?.epoch ?? 1;
    this.current = snapshot
      ? structuredClone({ ...snapshot, epoch: this.epoch })
      : null;
  }

  replace(
    snapshot:
      | (Omit<CurrentAuthoritySnapshot, "epoch"> & { readonly epoch?: number })
      | null,
  ): void {
    this.epoch++;
    this.current = snapshot
      ? structuredClone({ ...snapshot, epoch: this.epoch })
      : null;
  }

  async resolve(): Promise<CurrentAuthoritySnapshot | null> {
    const epoch = this.epoch;
    const snapshot = structuredClone(this.current);
    await this.afterCapture();
    if (epoch !== this.epoch) throw new AuthorityError("binding-changed");
    return snapshot ? { ...snapshot, epoch } : null;
  }
}
