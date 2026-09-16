import { AuthorityError } from "../domain/contracts.js";
import type { Grant, Identity, Receipt, Request } from "../domain/contracts.js";
import {
  assertBinding,
  assertIdentity,
  assertLive,
  assertOwner,
  makeReceipt,
} from "../domain/policy.js";
import {
  equal,
  parseBinding,
  parseCompletion,
  parseGrant,
  parseIdentity,
  parseOwnerEvidence,
  parseReceipt,
  parseRequest,
} from "../domain/validation.js";
import type {
  AuthorityIoBudget,
  AuthorityLedger,
  AuthorityPorts,
  AuthorityRecord,
  AuthorityScope,
} from "./ports.js";

/** Pure DI composition. Authentication belongs to the trusted caller, never the request body. */
export class SdkGrowthAuthority {
  constructor(
    private readonly ports: AuthorityPorts,
    private readonly ttlMs: number,
    private readonly ioTimeoutMs = 5_000,
  ) {
    if (
      !Number.isSafeInteger(ioTimeoutMs) ||
      ioTimeoutMs <= 0 ||
      ioTimeoutMs > 60_000
    )
      throw new AuthorityError("invalid-contract");
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 3_600_000)
      throw new AuthorityError("invalid-contract");
  }

  async request(authenticated: Identity, body: unknown): Promise<Grant> {
    const identity = parseIdentity(authenticated);
    const request = parseRequest(body);
    const scope = this.scope(identity, request);
    return this.ports.receipts.transact(scope, async (ledger) => {
      const previous = ledger.records.find(
        (record) => record.grant.request.requestId === request.requestId,
      );
      if (previous) {
        assertIdentity(previous.grant.identity, identity);
        if (!equal(previous.grant.request, request))
          throw new AuthorityError("conflict");
        // Replay is historical: it does not extend expiry, restore revocation or advance fences.
        return parseGrant(previous.grant);
      }
      const { binding, ownerEvidence: evidence } = await this.snapshot(
        identity,
        request,
      );
      if (
        binding.repositoryId !== request.repositoryId ||
        binding.pullRequest !== request.pullRequest
      )
        throw new AuthorityError("binding-changed");
      const now = this.now();
      assertOwner(identity, binding, evidence, now);
      if (
        !Number.isSafeInteger(ledger.fence + 1) ||
        !Number.isSafeInteger(now + this.ttlMs)
      )
        throw new AuthorityError("invalid-contract");
      const grant = parseGrant({
        version: 1,
        grantId: JSON.stringify([
          scope.tenantId,
          scope.repositoryId,
          scope.pullRequest,
          request.requestId,
        ]),
        identity,
        request,
        binding,
        ownerEvidence: evidence,
        fence: ++ledger.fence,
        issuedAt: now,
        expiresAt: Math.min(now + this.ttlMs, evidence.expiresAt),
      });
      ledger.records.push({
        grant,
        revoked: false,
        completion: null,
        receipt: null,
        intent: null,
        dispatched: false,
      });
      return structuredClone(grant);
    });
  }

  async complete(authenticated: Identity, body: unknown): Promise<Receipt> {
    const identity = parseIdentity(authenticated);
    const completion = parseCompletion(body);
    const scope = this.scope(identity, completion.binding);
    return this.ports.receipts.transact(scope, async (ledger) => {
      const record = this.record(ledger, completion.grantId, identity);
      if (record.completion) {
        if (!equal(record.completion, completion))
          throw new AuthorityError("conflict");
        return parseReceipt(record.receipt);
      }
      if (completion.fence !== record.grant.fence)
        throw new AuthorityError("fenced");
      assertBinding(record.grant.binding, completion.binding);
      const now = await this.live(record, ledger);
      const receipt = makeReceipt(record.grant, completion, now);
      record.completion = completion;
      record.receipt = receipt;
      record.intent = { version: 1, intentId: receipt.receiptId, receipt };
      return structuredClone(receipt);
    });
  }

  async revoke(authenticated: Identity, requestBody: unknown): Promise<void> {
    const identity = parseIdentity(authenticated);
    const request = parseRequest(requestBody);
    await this.ports.receipts.transact(
      this.scope(identity, request),
      async (ledger) => {
        const record = ledger.records.find(
          (item) => item.grant.request.requestId === request.requestId,
        );
        if (!record) throw new AuthorityError("not-found");
        assertIdentity(record.grant.identity, identity);
        // Per-grant revocation cannot fence a newer independent grant.
        record.revoked = true;
      },
    );
  }

  /** Retryable outbox handoff. A successful replay never creates a second intent. */
  async dispatch(authenticated: Identity, requestBody: unknown): Promise<void> {
    const identity = parseIdentity(authenticated);
    const request = parseRequest(requestBody);
    await this.ports.receipts.transact(
      this.scope(identity, request),
      async (ledger) => {
        const record = ledger.records.find(
          (item) => item.grant.request.requestId === request.requestId,
        );
        if (!record) throw new AuthorityError("not-found");
        assertIdentity(record.grant.identity, identity);
        if (!record.intent) throw new AuthorityError("not-found");
        if (record.dispatched) return;
        await this.live(record, ledger);
        const intent = structuredClone(record.intent);
        await this.bounded(
          (budget) => this.ports.publication.enqueue(intent, budget),
          "unknown",
        );
        record.dispatched = true;
      },
    );
  }

  /** Historical receipts are not bearer tokens. Consumers must call this before publication.
   * The future publication adapter must also fence the provider write against newer intents and authority changes. */
  async currentReceipt(
    authenticated: Identity,
    requestBody: unknown,
  ): Promise<Receipt> {
    const identity = parseIdentity(authenticated);
    const request = parseRequest(requestBody);
    return this.ports.receipts.transact(
      this.scope(identity, request),
      async (ledger) => {
        const record = ledger.records.find(
          (item) => item.grant.request.requestId === request.requestId,
        );
        if (!record) throw new AuthorityError("not-found");
        assertIdentity(record.grant.identity, identity);
        if (!record.receipt) throw new AuthorityError("not-found");
        await this.live(record, ledger);
        return parseReceipt(record.receipt);
      },
    );
  }

  private async live(
    record: AuthorityRecord,
    ledger: AuthorityLedger,
  ): Promise<number> {
    const grant = record.grant;
    assertLive(grant, record.revoked, ledger.fence, this.now());
    const { binding, ownerEvidence: evidence } = await this.snapshot(
      grant.identity,
      grant.request,
    );
    assertBinding(grant.binding, binding);
    const now = this.now();
    assertOwner(grant.identity, grant.binding, evidence, now);
    if (!equal(grant.ownerEvidence, evidence))
      throw new AuthorityError("owner-evidence");
    // Slow authority reads must not allow an expired completion to commit.
    assertLive(grant, record.revoked, ledger.fence, now);
    return now;
  }
  private async snapshot(identity: Identity, request: Request) {
    const snapshot = await this.bounded((budget) =>
      this.ports.currentAuthority.resolve(identity, request, budget),
    );
    if (!snapshot) throw new AuthorityError("binding-changed");
    return {
      binding: parseBinding(snapshot.binding),
      ownerEvidence: parseOwnerEvidence(snapshot.ownerEvidence),
    };
  }
  private async bounded<T>(
    operation: (budget: AuthorityIoBudget) => Promise<T>,
    effect: "none" | "unknown" = "none",
  ): Promise<T> {
    const controller = new AbortController();
    const deadline = performance.now() + this.ioTimeoutMs;
    const error = new AuthorityError("io-timeout", effect);
    const budget: AuthorityIoBudget = {
      signal: controller.signal,
      assertActive: () => {
        if (controller.signal.aborted || performance.now() >= deadline) {
          controller.abort(error);
          throw error;
        }
      },
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Reject before notifying adapters: abort listeners may settle their promise.
        reject(error);
        controller.abort(error);
      }, this.ioTimeoutMs);
    });
    try {
      const result = await Promise.race([operation(budget), timeout]);
      budget.assertActive();
      return result;
    } finally {
      clearTimeout(timer);
      // Also invalidate retained budgets after successful or failed calls.
      controller.abort(error);
    }
  }
  private record(
    ledger: AuthorityLedger,
    grantId: string,
    identity: Identity,
  ): AuthorityRecord {
    const record = ledger.records.find(
      (item) => item.grant.grantId === grantId,
    );
    if (!record) throw new AuthorityError("not-found");
    assertIdentity(record.grant.identity, identity);
    return record;
  }
  private scope(
    identity: Identity,
    request: Pick<Request, "repositoryId" | "pullRequest">,
  ): AuthorityScope {
    if (identity.repositoryId !== request.repositoryId)
      throw new AuthorityError("wrong-identity");
    return {
      tenantId: identity.tenantId,
      repositoryId: identity.repositoryId,
      pullRequest: request.pullRequest,
    };
  }
  private now(): number {
    const now = this.ports.clock.now();
    if (!Number.isSafeInteger(now) || now < 0)
      throw new AuthorityError("invalid-contract");
    return now;
  }
}
