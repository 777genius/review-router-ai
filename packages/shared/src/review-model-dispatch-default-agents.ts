import type { ReviewAgentProfile } from "./review-agent-profile.js";
import {
  reviewModelWireProtocolMatchesTransport,
  type ReviewModelDispatchProfileV2,
} from "./review-model-dispatch-contract.js";

/** Validate immutable OCR defaults without modifying the published protocol. */
export function assertReviewModelDispatchDefaultAgents(
  profile: ReviewModelDispatchProfileV2,
  catalog: readonly ReviewAgentProfile[],
): void {
  for (const transport of profile.transports) {
    const ref = profile.defaultAgentProfileRefs[transport];
    const agent = catalog.find((item) => item.profileRef === ref);
    const requiredTransport =
      transport === "account_gateway" ? "account_gateway" : "provider_api";
    if (
      !profile.wireProtocols.some((protocol) =>
        reviewModelWireProtocolMatchesTransport(transport, protocol),
      ) ||
      !agent ||
      agent.agentKind !== "ocr" ||
      agent.reviewSkillsVersion !== 1 ||
      !agent.modelTransports.includes(requiredTransport)
    ) {
      throw new Error(
        `model dispatch default agent is incompatible: ${transport}`,
      );
    }
  }
}
