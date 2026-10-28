import { required } from "@get-modular/core";
import {
  assemblyFor,
  declareModule,
  defineContract,
  group,
  implement,
  input,
  type Assembly,
  type CapabilitiesOf,
} from "@get-modular/assembly";
import { createReviewSkillsService } from "../application/create-review-skills-service.js";
import type {
  ReviewSkillsService,
  ReviewSkillsRepositoryAccessPort,
} from "../application/contracts.js";
import type { ReviewSkillsStore } from "../application/ports/review-skills-store.js";
export const SkillsStore = defineContract<ReviewSkillsStore>()({
  id: "reviewrouter/skills-store",
  revision: 1,
});
export const SkillsAccess = defineContract<ReviewSkillsRepositoryAccessPort>()({
  id: "reviewrouter/skills-access",
  revision: 1,
});
export const Skills = defineContract<ReviewSkillsService>()({
  id: "reviewrouter/skills",
  revision: 1,
});
export type ReviewSkillsCapabilities = CapabilitiesOf<
  typeof SkillsStore | typeof SkillsAccess | typeof Skills
>;
const owner = { authority: "reviewrouter", path: ["review-skills"] } as const;
export const storeDeclaration = declareModule({
  moduleId: "reviewrouter/skills-store",
  implementationId: "reviewrouter/skills-store/host",
  owner,
  provides: [SkillsStore.provide()],
  slots: [],
});
export const accessDeclaration = declareModule({
  moduleId: "reviewrouter/skills-access",
  implementationId: "reviewrouter/skills-access/host",
  owner,
  provides: [SkillsAccess.provide()],
  slots: [],
});
export const skillsDeclaration = declareModule({
  moduleId: "reviewrouter/skills",
  implementationId: "reviewrouter/skills/default",
  owner,
  provides: [Skills.provide()],
  slots: [
    SkillsStore.slot("store", required()),
    SkillsAccess.slot("access", required()),
  ],
});
export const storeInput = input<ReviewSkillsCapabilities>()(storeDeclaration);
export const accessInput = input<ReviewSkillsCapabilities>()(accessDeclaration);
export const skillsModule = implement<ReviewSkillsCapabilities>()(
  skillsDeclaration,
  async ({ store, access }) => {
    const service = createReviewSkillsService(store, access);
    return {
      instance: service,
      capabilities: { "reviewrouter/skills": service },
    };
  },
);
export const skillsGroup = group("review-skills", [skillsModule]);
export const composeReviewSkills = (api: Assembly<ReviewSkillsCapabilities>) =>
  api.prepare({
    profileId: "reviewrouter/review-skills",
    modules: [skillsGroup],
    roots: { skills: skillsModule },
    inputs: { store: storeInput, access: accessInput },
  });
export async function initializeReviewSkills(
  store: ReviewSkillsStore,
  access: ReviewSkillsRepositoryAccessPort,
) {
  const prepared =
    await composeReviewSkills(assemblyFor<ReviewSkillsCapabilities>());
  if (prepared.status === "failed") throw prepared.error;
  const outcome = await prepared.prepared.run({
    inputs: {
      store: { "reviewrouter/skills-store": store },
      access: { "reviewrouter/skills-access": access },
    },
  });
  if (outcome.status !== "succeeded")
    throw new Error("review_skills_composition_failed");
  return outcome.roots.skills;
}
