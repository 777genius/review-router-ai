import { createHash } from "node:crypto";

export type MemoryNativeStartupBinding = {
  readonly namespace: string;
  readonly generation: string;
  readonly imageDigest: string;
  readonly profile: string;
  readonly endpointDigest: string;
};
export type MemoryNativeStartupOwner = {
  readonly attemptId: string;
  readonly bindingDigest: string;
  readonly phase: "paused" | "complete" | "aborted";
};
export type MemoryNativeStartupState = {
  readonly generation: string;
  readonly epoch: string;
  readonly paused: boolean;
  readonly owner: MemoryNativeStartupOwner | null;
  readonly cleanupDebt: boolean;
};
export type MemoryNativeStartupInput = {
  readonly generation: string;
  readonly bindingDigest: string;
  readonly now: Date;
  readonly deadlineAt: Date;
};
export type MemoryNativeStartupChange = MemoryNativeStartupInput & {
  readonly attemptId: string;
  readonly expectedEpoch: string;
};
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hex = /^[a-f0-9]{64}$/;
export const nativeStartupBarrierKey = "memory-native-startup:v1";

/** Canonical bodyless provider identity; credentials never enter this digest. */
export function memoryNativeStartupBindingDigest(
  binding: MemoryNativeStartupBinding,
): string {
  if (
    !/^[a-zA-Z0-9_-]{1,100}$/.test(binding.namespace) ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(binding.generation) ||
    !/^sha256:[a-f0-9]{64}$/.test(binding.imageDigest) ||
    binding.profile !== "hindsight-v1.1.0-chunks-v1" ||
    !hex.test(binding.endpointDigest)
  )
    throw new Error("memory_startup_format_invalid");
  return createHash("sha256")
    .update(
      JSON.stringify([
        "memory-native-startup/v1",
        binding.namespace,
        binding.generation,
        binding.imageDigest,
        binding.profile,
        binding.endpointDigest,
      ]),
    )
    .digest("hex");
}

/** Only the authenticated owner constructs this reserved maintenance actor. */
export function nativeStartupActor(owner: MemoryNativeStartupOwner): string {
  if (
    !uuid.test(owner.attemptId) ||
    !hex.test(owner.bindingDigest) ||
    !["paused", "complete", "aborted"].includes(owner.phase)
  )
    throw new Error("memory_startup_format_invalid");
  return `startup:v1:${owner.attemptId}:${owner.bindingDigest}:${owner.phase}`;
}
export function readNativeStartupOwner(
  actor: string,
): MemoryNativeStartupOwner | null {
  if (!actor.startsWith("startup:")) return null;
  const match = /^startup:v1:([^:]+):([^:]+):(paused|complete|aborted)$/.exec(
    actor,
  );
  if (!match) throw new Error("memory_startup_owner_invalid");
  const owner = {
    attemptId: match[1]!,
    bindingDigest: match[2]!,
    phase: match[3]! as "paused" | "complete" | "aborted",
  };
  if (nativeStartupActor(owner) !== actor)
    throw new Error("memory_startup_owner_invalid");
  return owner;
}
