import { reviewActionV2SupportedContracts } from "@reviewrouter/protocol-review-action-v2";
import { describe, expect, it } from "vitest";
import { ReviewProtocolVersion } from "@reviewrouter/features-review-run-control";
import {
  assessRollbackProtocolCompatibility,
  parseWorkflowChannelContract,
} from "./review-action-v2-rollback-protocol-preflight.js";

const CURRENT = {
  protocolVersion: "2",
  schemaDigest: "a".repeat(64),
  canonicalizerDigest: "b".repeat(64),
} as const;
const LEGACY = {
  protocolVersion: "2",
  schemaDigest: "c".repeat(64),
  canonicalizerDigest: "d".repeat(64),
} as const;
const HISTORICAL = {
  protocolVersion: "2",
  schemaDigest: "e".repeat(64),
  canonicalizerDigest: "f".repeat(64),
} as const;

function channelManifest(contract: {
  protocolVersion: string;
  schemaDigest: string;
  canonicalizerDigest: string;
}): string {
  return JSON.stringify({
    contractSourceVersion: 1,
    protocolVersion: Number(contract.protocolVersion),
    schemaDigest: contract.schemaDigest,
    canonicalizerDigest: contract.canonicalizerDigest,
  });
}

const baseline = {
  targetContracts: [CURRENT, LEGACY],
  channelManifestSource: channelManifest(CURRENT),
  attestations: [
    {
      producerReleaseId: "release-current",
      schemaDigest: CURRENT.schemaDigest,
      canonicalizerDigest: CURRENT.canonicalizerDigest,
    },
    {
      producerReleaseId: "release-legacy",
      schemaDigest: LEGACY.schemaDigest,
      canonicalizerDigest: LEGACY.canonicalizerDigest,
    },
  ],
  activeAuthorizations: [
    {
      authorizationId: "authorization-1",
      producerReleaseId: "release-current",
      selectedProtocolVersion: ReviewProtocolVersion.V2,
      schemaDigest: CURRENT.schemaDigest,
    },
  ],
  retainedProducerReleases: [
    { producerReleaseId: "release-legacy", schemaDigest: LEGACY.schemaDigest },
  ],
} as const;

describe("assessRollbackProtocolCompatibility", () => {
  it("preserves approved171 and both other compiled producer tuples in the real target inventory", () => {
    const contracts = reviewActionV2SupportedContracts();
    expect(contracts).toHaveLength(3);
    const attestations = contracts.map((contract, index) => ({
      ...contract,
      producerReleaseId: `release-${index}`,
    }));
    const input = {
      channelManifestSource: channelManifest(contracts[0]!),
      attestations,
      activeAuthorizations: attestations.map((contract, index) => ({
        authorizationId: `auth-${index}`,
        producerReleaseId: contract.producerReleaseId,
        selectedProtocolVersion: ReviewProtocolVersion.V2,
        schemaDigest: contract.schemaDigest,
      })),
      retainedProducerReleases: attestations,
    };
    expect(assessRollbackProtocolCompatibility(input).status).toBe(
      "compatible",
    );
    expect(
      assessRollbackProtocolCompatibility({
        ...input,
        targetContracts: contracts.filter(
          (contract) => !contract.canonicalizerDigest.startsWith("95a433"),
        ),
      }).status,
    ).toBe("protocol_incompatible");
  });

  it("proves a rollback when the target supports channel, runs and producers", () => {
    const original = structuredClone(baseline);
    const result = assessRollbackProtocolCompatibility(baseline);
    expect(result.status).toBe("compatible");
    expect(result.code).toBe("rollback_protocol_preflight_passed");
    if (result.status !== "compatible") throw new Error("unreachable");
    expect(result.requiredContracts).toHaveLength(3);
    expect(
      result.requiredContracts.find(
        (entry) => entry.source === "authorization",
      ),
    ).toEqual({
      source: "authorization",
      consumer: "authorization-1",
      protocolVersion: "2",
      schemaDigest: CURRENT.schemaDigest,
      canonicalizerDigest: CURRENT.canonicalizerDigest,
    });
    expect(baseline).toEqual(original);
  });

  it("continues accepting an authorization already expressed as wire version 2", () => {
    expect(
      assessRollbackProtocolCompatibility({
        ...baseline,
        activeAuthorizations: [
          { ...baseline.activeAuthorizations[0], selectedProtocolVersion: "2" },
        ],
      }).status,
    ).toBe("compatible");
  });

  it.each(["review_action_v1", "review_action_v3", "3", "unknown", ""])(
    "rejects authorization protocol version %s despite matching digests",
    (selectedProtocolVersion) => {
      const result = assessRollbackProtocolCompatibility({
        ...baseline,
        activeAuthorizations: [
          { ...baseline.activeAuthorizations[0], selectedProtocolVersion },
        ],
      });
      expect(result.status).toBe("protocol_incompatible");
      if (result.status !== "protocol_incompatible")
        throw new Error("unreachable");
      expect(result.unsupported).toEqual([
        expect.objectContaining({
          source: "authorization",
          protocolVersion: selectedProtocolVersion,
        }),
      ]);
    },
  );

  it.each(["schemaDigest", "canonicalizerDigest"] as const)(
    "still requires the exact authorization %s after translating the domain version",
    (digest) => {
      const result = assessRollbackProtocolCompatibility({
        ...baseline,
        targetContracts: [LEGACY, { ...CURRENT, [digest]: "0".repeat(64) }],
      });
      expect(result.status).toBe("protocol_incompatible");
      if (result.status !== "protocol_incompatible")
        throw new Error("unreachable");
      expect(result.unsupported.map((entry) => entry.source)).toContain(
        "authorization",
      );
    },
  );

  it("permits replacing the API only when the rollback is proven compatible", () => {
    const rejected = assessRollbackProtocolCompatibility({
      ...baseline,
      targetContracts: [LEGACY],
    });
    expect(rejected.status).toBe("protocol_incompatible");
    expect(rejected.code).toBe("rollback_protocol_preflight_rejected");

    const notProven = assessRollbackProtocolCompatibility({
      ...baseline,
      attestations: null,
    });
    expect(notProven.status).toBe("inventory_incomplete");
    expect(notProven.code).toBe("rollback_protocol_preflight_not_proven");

    expect(assessRollbackProtocolCompatibility(baseline).status).toBe(
      "compatible",
    );
  });

  it("rejects a target without the channel contract", () => {
    const result = assessRollbackProtocolCompatibility({
      ...baseline,
      targetContracts: [LEGACY],
    });
    expect(result.status).toBe("protocol_incompatible");
    if (result.status !== "protocol_incompatible")
      throw new Error("unreachable");
    expect(result.code).toBe("rollback_protocol_preflight_rejected");
    expect(result.unsupported.map((entry) => entry.source)).toEqual([
      "workflow_channel",
      "authorization",
    ]);
  });

  it("rejects a retained producer whose canonicalizer matches no target slot", () => {
    const result = assessRollbackProtocolCompatibility({
      ...baseline,
      targetContracts: [CURRENT, LEGACY],
      attestations: [
        ...(baseline.attestations as readonly {
          producerReleaseId: string;
          schemaDigest: string;
          canonicalizerDigest: string;
        }[]),
        {
          producerReleaseId: "release-historical",
          schemaDigest: HISTORICAL.schemaDigest,
          canonicalizerDigest: HISTORICAL.canonicalizerDigest,
        },
      ],
      retainedProducerReleases: [
        {
          producerReleaseId: "release-legacy",
          schemaDigest: LEGACY.schemaDigest,
        },
        {
          producerReleaseId: "release-historical",
          schemaDigest: HISTORICAL.schemaDigest,
        },
      ],
    });
    expect(result.status).toBe("protocol_incompatible");
    if (result.status !== "protocol_incompatible")
      throw new Error("unreachable");
    expect(result.unsupported.map((entry) => entry.consumer)).toEqual([
      "release-historical",
    ]);
  });

  it("is never proven without an attestation for an active authorization", () => {
    const result = assessRollbackProtocolCompatibility({
      ...baseline,
      attestations: [],
    });
    expect(result.status).toBe("inventory_incomplete");
    if (result.status !== "inventory_incomplete")
      throw new Error("unreachable");
    expect(result.code).toBe("rollback_protocol_preflight_not_proven");
    expect(result.missing).toContain("authorization:authorization-1");
  });

  it("is never proven without an attestation for a retained producer", () => {
    const result = assessRollbackProtocolCompatibility({
      ...baseline,
      activeAuthorizations: [],
      attestations: [],
    });
    expect(result.status).toBe("inventory_incomplete");
    if (result.status !== "inventory_incomplete")
      throw new Error("unreachable");
    expect(result.missing).toContain("producer_release:release-legacy");
  });

  it("is never proven when the attestation inventory cannot be read", () => {
    const result = assessRollbackProtocolCompatibility({
      ...baseline,
      attestations: null,
    });
    expect(result.status).toBe("inventory_incomplete");
    if (result.status !== "inventory_incomplete")
      throw new Error("unreachable");
    expect(result.missing).toContain("producer_release_attestations");
  });

  it("is never proven without a readable channel manifest", () => {
    const result = assessRollbackProtocolCompatibility({
      ...baseline,
      channelManifestSource: null,
    });
    expect(result.status).toBe("inventory_incomplete");
    if (result.status !== "inventory_incomplete")
      throw new Error("unreachable");
    expect(result.missing).toContain("workflow_channel_manifest");
  });

  it("treats attestation digests that disagree with the inventory as incomplete", () => {
    const result = assessRollbackProtocolCompatibility({
      ...baseline,
      retainedProducerReleases: [
        {
          producerReleaseId: "release-legacy",
          schemaDigest: CURRENT.schemaDigest,
        },
      ],
    });
    expect(result.status).toBe("inventory_incomplete");
    if (result.status !== "inventory_incomplete")
      throw new Error("unreachable");
    expect(result.missing).toContain(
      "producer_release_attestation_mismatch:release-legacy",
    );
  });

  it("is never proven on ambiguous attestations for one producer release", () => {
    const result = assessRollbackProtocolCompatibility({
      ...baseline,
      attestations: [
        ...(baseline.attestations as readonly {
          producerReleaseId: string;
          schemaDigest: string;
          canonicalizerDigest: string;
        }[]),
        {
          producerReleaseId: "release-legacy",
          schemaDigest: LEGACY.schemaDigest,
          canonicalizerDigest: HISTORICAL.canonicalizerDigest,
        },
      ],
    });
    expect(result.status).toBe("inventory_incomplete");
    if (result.status !== "inventory_incomplete")
      throw new Error("unreachable");
    expect(result.missing).toContain(
      "producer_release_attestation_ambiguous:release-legacy",
    );
  });
});

describe("parseWorkflowChannelContract", () => {
  it("normalizes a numeric protocolVersion from the manifest", () => {
    expect(parseWorkflowChannelContract(channelManifest(CURRENT))).toEqual({
      protocolVersion: "2",
      schemaDigest: CURRENT.schemaDigest,
      canonicalizerDigest: CURRENT.canonicalizerDigest,
    });
  });

  it.each([
    null,
    "not-json",
    "{}",
    JSON.stringify({ protocolVersion: "2", schemaDigest: "short" }),
    JSON.stringify({
      protocolVersion: "2",
      schemaDigest: CURRENT.schemaDigest,
    }),
  ])("stays null for an unusable manifest (%s)", (source) => {
    expect(parseWorkflowChannelContract(source)).toBeNull();
  });
});
