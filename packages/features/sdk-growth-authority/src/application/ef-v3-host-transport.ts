import { createHash } from "node:crypto";

/** The fixed EF 1.6.0 transport boundary. EF owns interpretation of every
 * grant, receipt, observation, and installed-file claim. These ports are
 * supplied only by the trusted SaaS host, never by consumer configuration. */
export const efV3Schema = "reviewrouter:sdk-growth-authority:3" as const;
export const efV3RequiredPhases = [
  "topology", "observation", "packed", "decision", "trusted-base", "released", "authority",
] as const;
type Digest = `sha256:${string}`;
type Source = { readonly commit: string; readonly tree: string };

/** Mirrors only the request fields exposed by EF's public v3 entrypoint. The
 * host supplies their authenticated values; EF validates their semantics. */
export interface EfV3Binding {
  readonly invocation: {
    readonly repository: string;
    readonly sourceCommit: string;
    readonly sourceTree: string;
    readonly topologyDigest: Digest;
    readonly lockDigest: Digest;
    readonly toolchainDigest: Digest;
    readonly artifactDigests: readonly Digest[];
    readonly tool: { readonly version: string; readonly artifactDigest: Digest; readonly extractorVersion: string };
  };
  readonly target: {
    readonly repository: { readonly provider: string; readonly repositoryId: string; readonly owner: string; readonly name: string };
    readonly pullRequestNumber: number;
    readonly head: Source;
    readonly base: Source;
    readonly mergeBase: Source;
    readonly evaluation: Source;
    readonly evaluationKind: "head" | "merge-result" | "release-preimage";
  };
  readonly verifier: { readonly identity: string; readonly immutableRevision: string; readonly artifactDigest: Digest };
  readonly tool: { readonly packageName: "@agent-teams/engineering-foundation"; readonly version: string;
    readonly archiveDigest: Digest; readonly archiveIntegrity: string; readonly distributionDigest: Digest;
    readonly extractorVersion: string };
  readonly policy: { readonly contractRevision: "foundation:sdk-growth:c0:5";
    readonly policyVersion: "foundation:sdk-growth:policy:1"; readonly enrollmentRevision: string;
    readonly configurationDigest: Digest; readonly scopeDigest: Digest; readonly commandDigest: Digest };
  readonly historyDigest: Digest;
  readonly evidenceManifestDigest: Digest;
}

interface ContextSelectors {
  readonly trustedBasePath: string;
  readonly decisionsPath: string;
  readonly released: readonly ({ readonly packageName: string } & (
    | { readonly kind: "released"; readonly observationPath: string }
    | { readonly kind: "initial-unreleased"; readonly trustedHistoryPath: string }
  ))[];
}

export interface EfV3Request {
  readonly schemaVersion: typeof efV3Schema;
  readonly kind: "request";
  readonly operation: "check" | "promote-release";
  readonly admissionReceiptId: string | null;
  readonly binding: EfV3Binding;
  readonly contextSelectors: ContextSelectors;
  readonly decisionDigests: readonly Digest[];
  readonly requiredPhases: typeof efV3RequiredPhases;
}

export interface EfV3Completion {
  readonly schemaVersion: typeof efV3Schema;
  readonly kind: "completion";
  readonly grantId: string;
  readonly grantDigest: Digest;
  readonly requestDigest: Digest;
  readonly binding: EfV3Binding;
  readonly reportDigest: Digest;
  readonly reportByteLength: number;
  readonly coverageDigest: Digest;
  readonly phasesDigest: Digest;
  readonly verdict: "admitted" | "rejected" | "incomplete";
  readonly releaseEligible: boolean;
  readonly publication: "finalized";
  readonly promotion: { readonly kind: "none" } | { readonly kind: "plan"; readonly planDigest: Digest };
}

export interface EfV3ArchiveIdentity {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly archiveDigest: Digest;
  readonly archiveIntegrity: string;
  readonly source: { readonly commit: string; readonly tree: string };
}

export interface EfV3HostPort {
  resolve(input: {
    readonly request: EfV3Request;
    readonly canonicalRequestWire: Uint8Array;
    readonly requestWireDigest: Digest;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly wire: Uint8Array; readonly wireDigest: Digest }>;
  complete(input: {
    readonly completion: EfV3Completion;
    readonly canonicalCompletionWire: Uint8Array;
    readonly completionWireDigest: Digest;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly wire: Uint8Array; readonly wireDigest: Digest }>;
  readInstalled(input: {
    readonly identity: EfV3ArchiveIdentity;
    readonly signal?: AbortSignal;
  }): Promise<readonly { readonly path: string; readonly bytes: Uint8Array }[]>;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
    throw new TypeError("ef-v3-contract-invalid");
  return value as Record<string, unknown>;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("ef-v3-contract-invalid");
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError("ef-v3-contract-invalid");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(object(value)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

function digest(wire: Uint8Array): Digest {
  return `sha256:${createHash("sha256").update(wire).digest("hex")}`;
}

function phases(value: unknown): boolean {
  return Array.isArray(value) && value.length === efV3RequiredPhases.length &&
    efV3RequiredPhases.every((phase, index) => value[index] === phase);
}

function request(value: unknown): EfV3Request {
  const row = object(value);
  if (row.schemaVersion !== efV3Schema || row.kind !== "request" ||
    !["check", "promote-release"].includes(row.operation as string) ||
    !phases(row.requiredPhases)) throw new TypeError("ef-v3-request-invalid");
  object(row.binding);
  object(row.contextSelectors);
  if (!Array.isArray(row.decisionDigests)) throw new TypeError("ef-v3-request-invalid");
  return structuredClone(row) as unknown as EfV3Request;
}

function completion(value: unknown): EfV3Completion {
  const row = object(value);
  if (row.schemaVersion !== efV3Schema || row.kind !== "completion" ||
    row.publication !== "finalized" || typeof row.grantId !== "string" ||
    typeof row.requestDigest !== "string" || typeof row.grantDigest !== "string")
    throw new TypeError("ef-v3-completion-invalid");
  object(row.binding);
  object(row.promotion);
  return structuredClone(row) as unknown as EfV3Completion;
}

function response(value: { readonly wire: Uint8Array; readonly wireDigest: Digest }, kind: "grant" | "receipt"): Uint8Array {
  if (!(value.wire instanceof Uint8Array) || value.wire.byteLength === 0 || value.wire.byteLength > 32 * 1024 * 1024)
    throw new TypeError("ef-v3-wire-invalid");
  const wire = Uint8Array.from(value.wire);
  if (digest(wire) !== value.wireDigest) throw new TypeError("ef-v3-wire-digest-mismatch");
  const parsed = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(wire)));
  if (parsed.schemaVersion !== efV3Schema || parsed.kind !== kind) throw new TypeError("ef-v3-response-invalid");
  return wire;
}

/** No production composition: the host must independently authenticate every
 * item it returns. EF subsequently validates the closed v3 grant, exact
 * archive inventory, coverage, owner evidence, and final receipt. */
export function createEfV3HostTransport(host: EfV3HostPort) {
  return Object.freeze({
    async resolve(value: unknown, signal?: AbortSignal): Promise<Uint8Array> {
      const parsed = request(value);
      const wire = new TextEncoder().encode(canonical(parsed));
      return response(await host.resolve({ request: parsed, canonicalRequestWire: wire,
        requestWireDigest: digest(wire), ...(signal === undefined ? {} : { signal }) }), "grant");
    },
    async complete(value: unknown, signal?: AbortSignal): Promise<Uint8Array> {
      const parsed = completion(value);
      const wire = new TextEncoder().encode(canonical(parsed));
      return response(await host.complete({ completion: parsed, canonicalCompletionWire: wire,
        completionWireDigest: digest(wire), ...(signal === undefined ? {} : { signal }) }), "receipt");
    },
  });
}

export function createEfV3InstalledInventoryReader(host: EfV3HostPort) {
  return Object.freeze({
    async read(identity: EfV3ArchiveIdentity, cancellation: { readonly signal?: AbortSignal; throwIfCancelled(): void }) {
      cancellation.throwIfCancelled();
      const files = await host.readInstalled({ identity: structuredClone(identity),
        ...(cancellation.signal === undefined ? {} : { signal: cancellation.signal }) });
      cancellation.throwIfCancelled();
      return files.map(file => ({ path: file.path, bytes: Uint8Array.from(file.bytes) }));
    },
  });
}
