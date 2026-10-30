/** Qualification comes from the deployment executor, never an idle counter. */
export type ManagedResolutionWriterDrainQualification = Readonly<{
  writerDigest: string;
  qualificationSource: "managed_executor_handler_settlement.v1";
  executors: readonly Readonly<{
    executorId: string;
    binaryDigest: string;
    acceptsNewRequests: false;
    handlerSettlement: "terminal_or_exact_durable_pending";
  }>[];
}>;

/** Retirement and ingress removal do not establish terminal outcomes of old promises. */
export type RetiredLegacyWritersQuarantineQualification = Readonly<{
  qualificationSource: "retired_legacy_writers_quarantine.v1";
  writerDigest: string;
  scopeKind: "all_managed_legacy_resolution_writers";
  inventoryComplete: true;
  retiredAt: string;
  executorSetHash: string;
  proofHash: string;
  executors: readonly Readonly<{
    executorId: string;
    binaryDigest: string;
    retiredAt: string;
    acceptsNewRequests: false;
    restartable: false;
  }>[];
  ingress: Readonly<{ observedAt: string; oldExecutorIds: readonly string[] }>;
}>;

export type ResolutionWriterDrainQualification =
  | ManagedResolutionWriterDrainQualification
  | RetiredLegacyWritersQuarantineQualification;

export const resolutionWriterWitnessPurpose =
  "reviewrouter.resolution-writer-qualification.v1" as const;

export type ResolutionWriterWitnessBinding = Readonly<{
  environmentId: string;
  deploymentRevision: string;
  artifactDigest: string;
  fleetDigest: string;
  database: Readonly<{
    serverIdentity: string;
    databaseIdentity: string;
    databaseName: string;
    recoveryWitnessSha256: string;
  }>;
}>;

/** A cut's original qualification remains stable; fresh observations establish
 * its applicability without converting retirement into handler settlement. */
export type ResolutionWriterWitnessUnsigned = ResolutionWriterWitnessBinding &
  Readonly<{
    purpose: typeof resolutionWriterWitnessPurpose;
    proof: ResolutionWriterDrainQualification;
    observedAt: string;
    expiresAt: string;
  }>;

export type ResolutionWriterWitness = ResolutionWriterWitnessUnsigned &
  Readonly<{
    bindingSha256: string;
    signature: Readonly<{ algorithm: "Ed25519"; keyId: string; value: string }>;
  }>;

/** Implemented by the actual deployment authority; never accepts caller assertions as observations. */
export interface ResolutionWriterFleetObservationPort {
  observe(): Promise<
    ResolutionWriterWitnessBinding &
      Readonly<{
        proof: ResolutionWriterDrainQualification;
        observedAt: string;
      }>
  >;
}
