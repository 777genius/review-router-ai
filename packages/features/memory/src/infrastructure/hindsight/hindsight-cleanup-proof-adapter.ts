import type { MemoryCleanupProofPort } from "../../application/ports/memory-cleanup-proof-port";
import type {
  MemoryKnowledgeMaintenanceState,
  MemoryStoredCommand,
} from "../../application/ports/memory-knowledge-store-port";
import {
  MemoryKnowledgeError,
  memoryKnowledgeDigest,
  memoryKnowledgeScopeKey,
} from "../../domain/memory-knowledge";
import { hindsightMemoryBankId } from "./hindsight-scope";
import {
  hindsightCleanupBankDigest,
  hindsightCleanupDigest,
  verifyHindsightCleanupReceipt,
  type HindsightCleanupBinding,
} from "./hindsight-cleanup-receipt";

export class HindsightCleanupProofAdapter implements MemoryCleanupProofPort {
  constructor(
    private readonly config: {
      readonly namespace: string;
      readonly generation: string;
      readonly imageDigest: string;
      readonly publicKeys: Readonly<Record<string, string>>;
    },
  ) {}

  describe(input: {
    readonly command: MemoryStoredCommand;
    readonly maintenance: MemoryKnowledgeMaintenanceState;
  }): HindsightCleanupBinding {
    const { command, maintenance } = input;
    if (
      !maintenance.paused ||
      maintenance.generation !== this.config.generation
    )
      throw new MemoryKnowledgeError("conflict");
    return {
      namespace: this.config.namespace,
      generation: this.config.generation,
      scopeDigest: memoryKnowledgeDigest(
        memoryKnowledgeScopeKey(command.operation.ref.scope),
      ),
      bankIdDigest: hindsightCleanupBankDigest(
        hindsightMemoryBankId(this.config, command.operation.ref.scope),
      ),
      entryId: command.operation.ref.entryId,
      forgetCommandId: command.operation.id,
      imageDigest: this.config.imageDigest,
      pauseEpoch: maintenance.epoch,
    };
  }

  verify(
    input: Parameters<MemoryCleanupProofPort["verify"]>[0],
  ): ReturnType<MemoryCleanupProofPort["verify"]> {
    const binding = this.describe(input);
    if (
      !verifyHindsightCleanupReceipt(
        input.proof,
        binding,
        this.config.publicKeys,
        input.now,
      )
    )
      return null;
    return {
      id: hindsightCleanupDigest(input.proof.proof),
      commandId: input.command.operation.id,
      commandDigest: input.command.digest,
      generation: this.config.generation,
      ref: input.command.operation.ref,
      verifiedAt: input.now.toISOString(),
      verifiedBy: `memory-cleanup:${input.proof.keyId}`,
      maintenanceEpoch: input.maintenance.epoch,
    };
  }
}

/** Missing verification configuration disables settlement, never ordinary review. */
export function createHindsightCleanupProofAdapter(
  config: { readonly namespace: string; readonly generation: string },
  env: Readonly<Record<string, string | undefined>>,
): MemoryCleanupProofPort | null {
  const imageDigest = env.REVIEW_ROUTER_MEMORY_HINDSIGHT_IMAGE_DIGEST;
  const encodedKeys = env.REVIEW_ROUTER_MEMORY_CLEANUP_PUBLIC_KEYS;
  if (!imageDigest && !encodedKeys) return null;
  if (
    !imageDigest ||
    !/^sha256:[a-f0-9]{64}$/.test(imageDigest) ||
    !encodedKeys ||
    encodedKeys.length > 32_768
  )
    throw new Error("memory_cleanup_configuration_invalid");
  let keys: unknown;
  try {
    keys = JSON.parse(encodedKeys);
  } catch {
    throw new Error("memory_cleanup_configuration_invalid");
  }
  if (
    !keys ||
    typeof keys !== "object" ||
    Array.isArray(keys) ||
    Object.keys(keys).length === 0 ||
    Object.keys(keys).length > 8 ||
    Object.entries(keys).some(
      ([key, value]) =>
        !/^[A-Za-z0-9_-]{1,64}$/.test(key) ||
        typeof value !== "string" ||
        value.length > 8_192,
    )
  )
    throw new Error("memory_cleanup_configuration_invalid");
  return new HindsightCleanupProofAdapter({
    ...config,
    imageDigest,
    publicKeys: keys as Readonly<Record<string, string>>,
  });
}
