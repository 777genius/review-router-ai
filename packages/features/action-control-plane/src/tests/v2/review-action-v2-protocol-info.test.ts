import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  reviewActionV2ContractSlot,
  reviewActionV2Pinned171Slot,
  reviewActionV2LegacySlot,
  reviewActionV2PublishedProtocolVersion,
  reviewActionV2PublishedSchemaDigest,
  reviewActionV2CanonicalizerDigest,
} from "@reviewrouter/protocol-review-action-v2";
import { registerReviewActionV2ProtocolInfoRoute } from "../../v2/interface/index.js";

async function readProtocolInfo() {
  const app = Fastify();
  registerReviewActionV2ProtocolInfoRoute(app);
  const response = await app.inject({
    method: "GET",
    url: "/api/action/v2/protocol-info",
  });
  return response;
}

describe("Review Action v2 protocol-info route", () => {
  it("lists all compiled producer contracts with public contract identifiers", async () => {
    const response = await readProtocolInfo();

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      infoVersion: 1,
      contracts: [
        {
          protocolVersion: reviewActionV2PublishedProtocolVersion,
          schemaDigest: reviewActionV2PublishedSchemaDigest,
          canonicalizerDigest: reviewActionV2CanonicalizerDigest,
        },
        {
          protocolVersion:
            reviewActionV2LegacySlot.reviewActionV2PublishedProtocolVersion,
          schemaDigest:
            reviewActionV2LegacySlot.reviewActionV2PublishedSchemaDigest,
          canonicalizerDigest:
            reviewActionV2LegacySlot.reviewActionV2CanonicalizerDigest,
        },
        {
          protocolVersion:
            reviewActionV2Pinned171Slot.reviewActionV2PublishedProtocolVersion,
          schemaDigest:
            reviewActionV2Pinned171Slot.reviewActionV2PublishedSchemaDigest,
          canonicalizerDigest:
            reviewActionV2Pinned171Slot.reviewActionV2CanonicalizerDigest,
        },
      ],
    });
  });

  it("matches every published descriptor to the selected parser and canonicalizer", async () => {
    const response = await readProtocolInfo();
    const body = response.json() as {
      contracts: readonly {
        protocolVersion: string;
        schemaDigest: string;
        canonicalizerDigest: string;
      }[];
    };

    expect(body.contracts).toHaveLength(3);
    const schemaDigests = new Set(
      body.contracts.map((contract) => contract.schemaDigest),
    );
    expect(schemaDigests.size).toBe(2);

    for (const contract of body.contracts) {
      const slot = reviewActionV2ContractSlot(
        contract.schemaDigest,
        contract.canonicalizerDigest,
      );
      expect(slot).not.toBeNull();
      expect(slot?.reviewActionV2PublishedProtocolVersion).toBe(
        contract.protocolVersion,
      );
      expect(slot?.reviewActionV2PublishedSchemaDigest).toBe(
        contract.schemaDigest,
      );
      expect(slot?.reviewActionV2CanonicalizerDigest).toBe(
        contract.canonicalizerDigest,
      );
      expect(
        reviewActionV2ContractSlot(contract.schemaDigest, "f".repeat(64)),
      ).toBeNull();
    }
  });
});
