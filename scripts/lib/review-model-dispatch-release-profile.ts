import { parseReviewAgentProfiles } from "../../packages/shared/dist/review-agent-profile.js";
import {
  assertReviewModelDispatchDefaultAgents,
  parseReviewModelDispatchProfileV2,
} from "../../packages/shared/dist/review-model-dispatch-contract.js";

// Reviewed S2 contract bytes. Append qualified identities rather than trusting
// a caller-provided digest or executing code from the public repository.
const supportedContractDigests = Object.freeze({
  "review-model-dispatch-contract.ts":
    "c9d91addfd46122d095908c42cf416527d438c374e8bb4f65a333d62bf4b1728",
  "review-model-route-policy.ts":
    "ac13197c14ca384276f96eba7ad85969ff8de47f976f041bd05ef026a5fc829c",
  "review-agent-profile.ts":
    "6da405b0a67d717010f012ba114864a9dc1f69534062a9bb98e4729742ffa190",
});

/** Producer policy needs both the reviewed wire implementation and its exact catalog. */
export function bindModelDispatchReleaseProfile(
  value: unknown,
  files: Readonly<Record<string, string>>,
  agentProfiles: unknown,
) {
  const profile = parseReviewModelDispatchProfileV2(value);
  for (const [file, digest] of Object.entries(supportedContractDigests)) {
    if (files[file] !== digest)
      throw new Error(
        `model dispatch profile has no reviewed contract binding: ${file}`,
      );
  }
  assertReviewModelDispatchDefaultAgents(
    profile,
    parseReviewAgentProfiles(agentProfiles),
  );
  return profile;
}
