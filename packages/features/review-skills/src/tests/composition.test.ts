import { describe, expect, it } from "vitest";
import { assemblyFor } from "@get-modular/assembly";
import { checkNamespaces, checkWiring, smoke } from "@get-modular/conformance";
import {
  composeReviewSkills,
  skillsDeclaration,
  storeDeclaration,
  accessDeclaration,
} from "../composition/review-skills.root.js";
import type { ReviewSkillsStore } from "../application/ports/review-skills-store.js";
import {
  createReviewSkillsService,
  validateReviewSkillContent,
  exactIds,
  normalizeSkillScope,
} from "../application/create-review-skills-service.js";
const unused = (): never => {
  throw new Error("fake command must not run during construction");
};
const store: ReviewSkillsStore = {
  loadWorkspaceCapabilities: unused,
  listWorkspaceSkills: unused,
  loadSkill: unused,
  createSkill: unused,
  saveSkill: unused,
  deleteSkill: unused,
  listLinkableSkills: unused,
  grantSkill: unused,
  revokeSkillGrant: unused,
  acceptSkillGrant: unused,
  linkSkillAsDualAdmin: unused,
  unlinkSkill: unused,
  loadSkillAccess: unused,
  listRepositoryTargetIds: unused,
  listSkillRepositoryTargets: unused,
  loadRepositorySkillSettings: unused,
  listAssignmentChoices: unused,
  applyAssignments: unused,
  updateBindingScope: unused,
  setRepositorySources: unused,
};
const access = { authorizeRepositoryManagement: async () => [] };
const declarations = [storeDeclaration, accessDeclaration, skillsDeclaration];
// Independent provider/namespace decisions; never derive these from declarations or plans.
const oracle = {
  providers: {
    "reviewrouter/skills-store": "reviewrouter/skills-store/host",
    "reviewrouter/skills-access": "reviewrouter/skills-access/host",
    "reviewrouter/skills": "reviewrouter/skills/default",
  },
  roots: ["reviewrouter/skills/default"],
};
describe("Review Skills actual Get Modular root", () => {
  it("qualifies explicit namespaces and independent wiring, rejects a wrong provider oracle", async () => {
    checkNamespaces({ namespace: "reviewrouter", declarations });
    expect(() =>
      checkNamespaces({ namespace: "foreign", declarations }),
    ).toThrow();
    const result = await composeReviewSkills(assemblyFor());
    expect(result.status).toBe("prepared");
    if (result.status !== "prepared") throw new Error("preparation failed");
    checkWiring(result.composition, [oracle], { declarations });
    expect(() =>
      checkWiring(
        result.composition,
        [
          {
            ...oracle,
            providers: {
              ...oracle.providers,
              "reviewrouter/skills": "reviewrouter/skills/wrong",
            },
          },
        ],
        { declarations },
      ),
    ).toThrow();
    const outcome = await result.prepared.run({
      inputs: {
        store: { "reviewrouter/skills-store": store },
        access: { "reviewrouter/skills-access": access },
      },
    });
    expect(outcome.status).toBe("succeeded");
    if (outcome.status === "succeeded")
      expect(Object.hasOwn(outcome.roots.skills, "saveSkill")).toBe(true);
  });
  it("runs public smoke failure/cancellation injections without owning borrowed resources", async () => {
    const steps = await smoke({
      api: assemblyFor(),
      compose: composeReviewSkills,
      inputs: {
        store: { "reviewrouter/skills-store": store },
        access: { "reviewrouter/skills-access": access },
      },
    });
    expect(steps.length).toBeGreaterThan(0);
  });
});
describe("Review Skills boundary validation", () => {
  it("validates the assigned-only read flag before invoking a store or permission check", async () => {
    const service = createReviewSkillsService(store, access);
    await expect(
      service.listAssignmentChoices({
        actor: { userId: "actor" },
        workspaceId: "workspace",
        repositoryIds: ["repo"],
        assignedOnly: "true" as unknown as boolean,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
  it("requires valid creation and assignment generation identities", async () => {
    const service = createReviewSkillsService(store, access);
    const common = { actor: { userId: "actor" }, workspaceId: "workspace" };
    expect(() =>
      service.createSkill({
        ...common,
        createOperationId: "invalid",
        content: { name: "Skill", description: "", instructions: "Review." },
      }),
    ).toThrow("review_skills_invalid_input");
    await expect(
      service.updateBindingScope({
        ...common,
        repositoryId: "repository",
        skillId: "skill",
        expectedGeneration: "",
        expectedVersion: 1,
        scope: { includePaths: ["**"], excludePaths: [] },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
  it("rejects blank content, oversized selection and unsupported scope syntax", () => {
    expect(() =>
      validateReviewSkillContent({
        name: "x",
        description: "",
        instructions: "  ",
      }),
    ).toThrow();
    expect(() =>
      exactIds(
        Array.from({ length: 1001 }, (_, i) => `repo-${i}`),
        1000,
      ),
    ).toThrow();
    expect(() =>
      normalizeSkillScope({ includePaths: ["../secrets"], excludePaths: [] }),
    ).toThrow();
    expect(
      normalizeSkillScope({
        includePaths: ["src/**"],
        excludePaths: ["src/generated/**"],
      }),
    ).toEqual({ includePaths: ["src/**"], excludePaths: ["src/generated/**"] });
  });
});
