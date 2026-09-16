import { AuthorityError } from "../domain/contracts.js";
import type {
  CurrentAuthoritySnapshot,
  CurrentAuthoritySnapshotPort,
  AuthorityLedger,
  AuthorityScope,
  ReceiptRepositoryPort,
} from "../application/ports.js";

/** Conformance adapter only. Production composition must supply durable serializable storage. */
export class InMemoryReceiptRepository implements ReceiptRepositoryPort {
  private readonly ledgers = new Map<string, AuthorityLedger>();
  private readonly tails = new Map<string, Promise<void>>();

  async transact<T>(
    scope: AuthorityScope,
    operation: (ledger: AuthorityLedger) => Promise<T>,
  ): Promise<T> {
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
      const draft = structuredClone(
        this.ledgers.get(key) ?? { fence: 0, records: [] },
      );
      const result = await operation(draft);
      const output = structuredClone(result);
      this.ledgers.set(key, structuredClone(draft));
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
  private epoch = 0;
  private current: CurrentAuthoritySnapshot | null;

  constructor(
    snapshot: CurrentAuthoritySnapshot | null,
    private readonly afterCapture: () => Promise<void> = async () => {},
  ) {
    this.current = structuredClone(snapshot);
  }

  replace(snapshot: CurrentAuthoritySnapshot | null): void {
    this.current = structuredClone(snapshot);
    this.epoch++;
  }

  async resolve(): Promise<CurrentAuthoritySnapshot | null> {
    const epoch = this.epoch;
    const snapshot = structuredClone(this.current);
    await this.afterCapture();
    if (epoch !== this.epoch) throw new AuthorityError("binding-changed");
    return snapshot;
  }
}
