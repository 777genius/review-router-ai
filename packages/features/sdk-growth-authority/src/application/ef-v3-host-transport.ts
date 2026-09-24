import { createHash } from "node:crypto";

/** The fixed EF 1.6.0 transport boundary. EF owns interpretation of every
 * grant, receipt, observation, and installed-file claim. These ports are
 * supplied only by the trusted SaaS host, never by consumer configuration. */
export const efV3Schema = "reviewrouter:sdk-growth-authority:3" as const;
export const efV3RequiredPhases = [
  "topology", "observation", "packed", "decision", "trusted-base", "released", "authority",
] as const;
type Digest = `sha256:${string}`;
/** Host inputs remain unknown. Only the trusted host may validate and
 * canonicalize them with the pinned EF domain before any host effect. */
export interface EfV3ArchiveIdentity {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly archiveDigest: Digest;
  readonly archiveIntegrity: string;
  readonly source: { readonly commit: string; readonly tree: string };
}

export interface EfV3HostPort {
  /** Reject unsupported EF canonical values and validate the full v3 request
   * before reading evidence, minting a grant, or performing any other effect.
   * Canonicalize the same validated snapshot with EF's growthCanonicalJson. */
  resolve(input: { readonly request: unknown; readonly signal?: AbortSignal }):
    Promise<{ readonly wire: Uint8Array; readonly wireDigest: Digest }>;
  /** Apply the same rule before recording or publishing a completion. */
  complete(input: { readonly completion: unknown; readonly signal?: AbortSignal }):
    Promise<{ readonly wire: Uint8Array; readonly wireDigest: Digest }>;
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

function digest(wire: Uint8Array): Digest {
  return `sha256:${createHash("sha256").update(wire).digest("hex")}`;
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

/** No production composition: the host must validate and canonicalize each
 * unknown request or completion before an effect, and authenticate every item
 * it returns. EF subsequently validates the closed v3 grant, exact archive
 * inventory, coverage, owner evidence, and final receipt. */
export function createEfV3HostTransport(host: EfV3HostPort) {
  return Object.freeze({
    async resolve(value: unknown, signal?: AbortSignal): Promise<Uint8Array> {
      return response(await host.resolve({ request: value,
        ...(signal === undefined ? {} : { signal }) }), "grant");
    },
    async complete(value: unknown, signal?: AbortSignal): Promise<Uint8Array> {
      return response(await host.complete({ completion: value,
        ...(signal === undefined ? {} : { signal }) }), "receipt");
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
