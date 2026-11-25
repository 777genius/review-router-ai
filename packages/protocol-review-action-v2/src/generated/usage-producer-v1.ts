// Generated from codex-oauth-rotating/action/provider-usage-delivery.ts. Do not edit.
import { createHash, generateKeyPairSync, sign } from "crypto";
import {
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  mkdtempSync,
} from "fs";
import { join } from "path";
import {
  canonicalJson,
  UsageFact,
  validateUsageFact,
  type UsageProducerCoverage,
} from "./usage-v1.js";

export interface UsageGrantScope {
  sourceInstance: string;
  callIdPrefix: string;
  provider: string;
  requestedModel: string | null;
  runtimeType: string;
  route: "direct" | "gateway";
  purpose?: "review" | "diagnostic";
  workspaceId: string;
  invocationId: string;
  repositoryId: string;
  runId: string;
  runAttempt: number;
  authorizationId: string;
  actorId: string | null;
  bindingId: string | null;
  producerDigest: string;
  workflowIdentity: string;
  jobIdentity: string;
}
export interface UsageGrant {
  grantId: string;
  grantToken: string;
  expiresAt: string;
  scope: UsageGrantScope;
}
export type ProducerCoverage = UsageProducerCoverage;
interface PendingFact {
  fact: UsageFact;
  hash: string;
}
export interface UsageDeliveryOptions {
  apiUrl: string;
  executionToken: string;
  invocationId: string;
  temporaryDirectory: string;
  fetchImpl?: typeof fetch;
  /** Upload only this safe JSON file under the provided fixed artifact name. */
  uploadArtifact: (name: string, file: string) => Promise<void>;
  status?: (status: "partial" | "pending" | "delivered") => void;
  maxSpoolBytes?: number;
  maxBatchBytes?: number;
  maxBatchFacts?: number;
}
const digest = (value: unknown): string =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");

/** One invocation, private memory-only credentials, bounded signed durable pending facts. */
export class UsageDelivery {
  readonly scope: UsageGrantScope;
  readonly artifactName: string;
  readonly artifactPath: string;
  private readonly pending = new Map<string, PendingFact>();
  private flushing: Promise<void> | undefined;
  private partial = false;
  private producerCoverage?: ProducerCoverage;
  private coverageAckRevision = 0;
  private constructor(
    private readonly options: UsageDeliveryOptions,
    private readonly grant: UsageGrant,
    private readonly privateKey: ReturnType<
      typeof generateKeyPairSync
    >["privateKey"],
    directory: string,
  ) {
    this.scope = Object.freeze({ ...grant.scope });
    this.artifactName = `reviewrouter-usage-v1-${this.scope.invocationId}-${this.scope.runAttempt}`;
    this.artifactPath = join(directory, "report.json");
    this.persist();
  }
  /** Pre-register the public key under current OIDC authorization, never expose custody. */
  static prepareRegistration() {
    const keys = generateKeyPairSync("ed25519");
    return {
      publicKey: keys.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
      acceptGrant: (
        options: UsageDeliveryOptions,
        grant: UsageGrant,
      ): UsageDelivery =>
        UsageDelivery.fromGrant(options, grant, keys.privateKey),
    };
  }
  static async create(options: UsageDeliveryOptions): Promise<UsageDelivery> {
    const url = new URL("/api/provider-usage/grants", options.apiUrl);
    if (url.protocol !== "https:") throw new Error("usage_https_required");
    const keys = generateKeyPairSync("ed25519");
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${options.executionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        invocationId: options.invocationId,
        publicKey: keys.publicKey.export({ type: "spki", format: "pem" }),
      }),
    });
    if (!response.ok) throw new Error("usage_grant_unavailable");
    const grant = (await response.json()) as UsageGrant;
    return UsageDelivery.fromGrant(options, grant, keys.privateKey);
  }
  private static fromGrant(
    options: UsageDeliveryOptions,
    grant: UsageGrant,
    privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  ): UsageDelivery {
    if (
      !grant.grantId ||
      !grant.grantToken ||
      !grant.scope ||
      typeof grant.scope.sourceInstance !== "string" ||
      typeof grant.scope.callIdPrefix !== "string" ||
      !grant.scope.callIdPrefix ||
      typeof grant.scope.provider !== "string" ||
      typeof grant.scope.runtimeType !== "string" ||
      !["direct", "gateway"].includes(grant.scope.route) ||
      grant.scope.invocationId !== options.invocationId ||
      !Number.isSafeInteger(grant.scope.runAttempt) ||
      grant.scope.runAttempt < 1 ||
      !Number.isFinite(Date.parse(grant.expiresAt)) ||
      Date.parse(grant.expiresAt) <= Date.now() ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(grant.scope.invocationId) ||
      ![
        grant.scope.producerDigest,
        grant.scope.workflowIdentity,
        grant.scope.jobIdentity,
      ].every((v) => typeof v === "string" && v.length > 0)
    ) {
      throw new Error("usage_grant_invalid");
    }
    const directory = mkdtempSync(
      join(options.temporaryDirectory, "reviewrouter-usage-"),
    );
    // Retain the execution token only through grant registration, never during delivery.
    return new UsageDelivery(
      { ...options, executionToken: "" },
      grant,
      privateKey,
      directory,
    );
  }
  /** Capture never throws into inference; a failed durable write marks coverage partial. */
  record(fact: UsageFact): boolean {
    try {
      validateUsageFact(fact);
      const i = fact.identity;
      if (
        fact.sourceInstance !== this.scope.sourceInstance ||
        (this.scope.route === "direct" &&
          !i.callId.startsWith(this.scope.callIdPrefix)) ||
        i.provider !== this.scope.provider ||
        i.requestedModel !== this.scope.requestedModel ||
        i.runtimeType !== this.scope.runtimeType ||
        i.route !== this.scope.route ||
        i.purpose !== (this.scope.purpose ?? "review")
      )
        throw new Error("usage_scope_mismatch");
      for (const key of [
        "workspaceId",
        "invocationId",
        "repositoryId",
        "runId",
        "runAttempt",
        "authorizationId",
        "actorId",
        "bindingId",
      ] as const) {
        if (i[key] !== this.scope[key]) throw new Error("usage_scope_mismatch");
      }
      const snapshot = JSON.parse(canonicalJson(fact)) as UsageFact;
      const key = canonicalJson([
        snapshot.sourceInstance,
        snapshot.eventId,
        snapshot.revision,
      ]);
      const hash = digest(snapshot);
      const existing = this.pending.get(key);
      if (existing) {
        if (existing.hash !== hash) throw new Error("usage_hash_conflict");
        return true;
      }
      this.pending.set(key, { fact: snapshot, hash });
      try {
        this.persist();
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "usage_spool_durability_unknown"
        )
          this.pending.delete(key);
        throw error;
      }
      this.reportStatus("pending");
      return true;
    } catch (error) {
      this.markPartial(
        error instanceof Error && error.message === "usage_spool_overflow"
          ? "spool_overflow"
          : error instanceof Error &&
              [
                "usage_invalid_fact",
                "usage_scope_mismatch",
                "usage_hash_conflict",
              ].includes(error.message)
            ? "producer_unavailable"
            : "spool_write_failed",
        1,
      );
      return false;
    }
  }
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.deliver().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }
  /** Always invoke from job finally, even when review throws. No inference retry. */
  async cleanup(): Promise<void> {
    try {
      await this.flush();
    } finally {
      if (this.pending.size || this.coveragePending()) {
        try {
          this.persist();
        } catch {
          this.markPartial("spool_write_failed");
        }
        try {
          await this.options.uploadArtifact(
            this.artifactName,
            this.artifactPath,
          );
        } catch {
          this.markPartial("delivery_failed");
        }
      }
    }
  }
  get coverage(): "partial" | "pending" | "delivered" {
    return this.partial
      ? "partial"
      : this.pending.size
        ? "pending"
        : "delivered";
  }
  markUnavailable(): void {
    this.markPartial("producer_unavailable");
  }
  scopeIdentity() {
    const {
      workspaceId,
      invocationId,
      repositoryId,
      runId,
      runAttempt,
      authorizationId,
      actorId,
      bindingId,
    } = this.scope;
    return {
      workspaceId,
      invocationId,
      repositoryId,
      runId,
      runAttempt,
      authorizationId,
      actorId,
      bindingId,
    };
  }
  private reportStatus(status: "partial" | "pending" | "delivered"): void {
    try {
      this.options.status?.(status);
    } catch {
      /* Analytics status cannot break inference. */
    }
  }
  private coveragePending(): boolean {
    return (
      this.producerCoverage !== undefined &&
      this.producerCoverage.revision > this.coverageAckRevision
    );
  }
  private markPartial(
    reason: ProducerCoverage["reason"],
    droppedEvents = 0,
  ): void {
    this.partial = true;
    if (
      droppedEvents ||
      !this.producerCoverage ||
      this.producerCoverage.reason !== reason ||
      this.coverageAckRevision >= this.producerCoverage.revision
    ) {
      this.producerCoverage = {
        schemaVersion: 1,
        revision: (this.producerCoverage?.revision ?? 0) + 1,
        state: "partial",
        reason,
        droppedEvents:
          (this.producerCoverage?.droppedEvents ?? 0) + droppedEvents,
        occurredAt: new Date().toISOString(),
      };
      // The capsule has a separate reserved budget, even when the fact spool is full.
      // Failed replacement leaves the previous signed report intact.
      try {
        this.persist();
      } catch {
        /* In-memory capsule still travels on flush; prior file retained. */
      }
    }
    this.reportStatus("partial");
  }
  private envelope() {
    const entries = [...this.pending.values()];
    return {
      schemaVersion: 1,
      grantId: this.grant.grantId,
      producerDigest: this.scope.producerDigest,
      workflowIdentity: this.scope.workflowIdentity,
      jobIdentity: this.scope.jobIdentity,
      invocationId: this.scope.invocationId,
      runAttempt: this.scope.runAttempt,
      facts: entries.map((e) => e.fact),
      eventHashes: entries.map((e) => e.hash),
      ...(this.producerCoverage
        ? { producerCoverage: { ...this.producerCoverage } }
        : {}),
    };
  }
  private persist(): void {
    const envelope = this.envelope();
    const signature = sign(
      null,
      Buffer.from(canonicalJson(envelope)),
      this.privateKey,
    ).toString("base64");
    const bytes = canonicalJson({ ...envelope, signature });
    const factEnvelope = { ...envelope };
    delete factEnvelope.producerCoverage;
    // Fact capacity excludes the reserved coverage capsule; total is still strictly bounded.
    const factBytes = canonicalJson({ ...factEnvelope, signature });
    if (
      Buffer.byteLength(factBytes) >
        (this.options.maxSpoolBytes ?? 4 * 1024 * 1024) ||
      Buffer.byteLength(bytes) >
        (this.options.maxSpoolBytes ?? 4 * 1024 * 1024) + 2048
    )
      throw new Error("usage_spool_overflow");
    const temporary = `${this.artifactPath}.new`;
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } catch (error) {
      try {
        unlinkSync(temporary);
      } catch {
        /* Preserve original durability failure. */
      }
      throw error;
    } finally {
      closeSync(fd);
    }
    try {
      renameSync(temporary, this.artifactPath);
    } catch (error) {
      unlinkSync(temporary);
      throw error;
    }
    const directoryFd = openSync(join(this.artifactPath, ".."), "r");
    try {
      fsyncSync(directoryFd);
    } catch {
      throw new Error("usage_spool_durability_unknown");
    } finally {
      closeSync(directoryFd);
    }
  }
  private async deliver(): Promise<void> {
    // Bound cleanup network work as well as each request/batch. Remaining facts go to artifact.
    for (
      let attempt = 0;
      attempt < 16 && (this.pending.size || this.coveragePending());
      attempt++
    ) {
      const batch: PendingFact[] = [];
      for (const entry of this.pending.values()) {
        const candidate = [...batch, entry];
        if (
          candidate.length > (this.options.maxBatchFacts ?? 100) ||
          Buffer.byteLength(canonicalJson(candidate.map((e) => e.fact))) >
            (this.options.maxBatchBytes ?? 256 * 1024)
        )
          break;
        batch.push(entry);
      }
      if (!batch.length && this.pending.size)
        this.markPartial("producer_unavailable");
      const sentCoverage = this.coveragePending()
        ? { ...this.producerCoverage! }
        : undefined;
      if (!batch.length && !sentCoverage) break;
      try {
        const response = await (this.options.fetchImpl ?? fetch)(
          new URL("/api/provider-usage/reports", this.options.apiUrl),
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(3000),
            headers: {
              Authorization: `Bearer ${this.grant.grantToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              schemaVersion: 1,
              facts: batch.map((e) => e.fact),
              producerDigest: this.scope.producerDigest,
              workflowIdentity: this.scope.workflowIdentity,
              jobIdentity: this.scope.jobIdentity,
              ...(sentCoverage ? { producerCoverage: sentCoverage } : {}),
            }),
          },
        );
        if (!response.ok) {
          this.markPartial("delivery_failed");
          break;
        }
        const body = (await response.json()) as {
          producerCoverageRevision?: number;
          accepted?: Array<{
            eventId: string;
            revision: number;
            hash: string;
            status: string;
          }>;
        };
        if (!Array.isArray(body.accepted)) {
          this.markPartial("delivery_failed");
          break;
        }
        const coverageAcked =
          sentCoverage !== undefined &&
          body.producerCoverageRevision === sentCoverage.revision;
        if (coverageAcked) this.coverageAckRevision = sentCoverage.revision;
        let removed = 0;
        for (const entry of batch) {
          if (
            body.accepted.some(
              (a) =>
                a.eventId === entry.fact.eventId &&
                a.revision === entry.fact.revision &&
                a.hash === entry.hash &&
                ["accepted", "duplicate"].includes(a.status),
            )
          ) {
            this.pending.delete(
              canonicalJson([
                entry.fact.sourceInstance,
                entry.fact.eventId,
                entry.fact.revision,
              ]),
            );
            removed++;
          }
        }
        if (!removed && !coverageAcked) {
          this.markPartial("delivery_failed");
          break;
        }
        this.persist();
      } catch {
        this.markPartial("delivery_failed");
        break;
      }
    }
    this.reportStatus(this.coverage);
  }
}

let usageArtifactUploadQueue: Promise<unknown> = Promise.resolve();
/** SDK-supported chunk abort plus a best-effort overall cleanup deadline.
 * Only usage uploads share this process-local environment lease. */
export function withUsageArtifactUploadTimeout<T>(
  upload: () => Promise<T>,
): Promise<T> {
  const task = usageArtifactUploadQueue.then(async () => {
    const key = "ACTIONS_ARTIFACT_UPLOAD_TIMEOUT_MS";
    const previous = process.env[key];
    const priorMs = Number(previous);
    const configured =
      Number.isSafeInteger(priorMs) && priorMs > 0 && priorMs < 30000
        ? previous!
        : "30000";
    process.env[key] = configured;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(upload),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("usage_artifact_cleanup_timeout")),
            35000,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      if (process.env[key] === configured) {
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      }
    }
  });
  usageArtifactUploadQueue = task.catch(() => {});
  return task;
}
