import { describe, expect, it, vi } from "vitest";
import {
  createReviewSkillsCatalogService,
  validateCatalogSelection,
} from "../application/create-review-skills-catalog-service.js";
import { processReviewSkillScan } from "../application/process-review-skill-scan.js";
import type { ReviewSkillsCatalogStore } from "../application/ports/review-skills-catalog-store.js";
import { scanProfile, nativeReport } from "./skill-catalog-fixtures.js";
import { assemblyFor } from "@get-modular/assembly";
import { checkNamespaces, checkWiring } from "@get-modular/conformance";
import {
  catalogDeclaration,
  catalogHostDeclaration,
  composeReviewSkillsCatalog,
} from "../composition/catalog.root.js";

const actor = { actor: { userId: "actor" }, workspaceId: "workspace" };
const id = "11111111-1111-1111-1111-111111111111";
function setup(profiles = [scanProfile()]) {
  const store = {
    authorize: vi.fn(),
    stage: vi.fn(),
    loadCandidate: vi.fn(),
    requestScan: vi.fn(),
    loadScan: vi.fn(),
    importCandidate: vi.fn(),
    beginScan: vi.fn(),
    finishScan: vi.fn(),
    pruneExpired: vi.fn(),
  } satisfies ReviewSkillsCatalogStore;
  const catalog = { search: vi.fn(), resolve: vi.fn() },
    normalizer = { normalize: vi.fn() },
    admission = { assertAllowed: vi.fn() };
  return {
    store,
    catalog,
    normalizer,
    admission,
    profiles,
    service: createReviewSkillsCatalogService({
      store,
      catalog,
      normalizer,
      admission,
      profiles,
    }),
  };
}
describe("Skills catalog application boundaries", () => {
  it("authorizes before remote work or request charging", async () => {
    const s = setup();
    s.store.authorize.mockRejectedValue(new Error("revoked"));
    await expect(s.service.search({ ...actor, query: "code" })).rejects.toThrow(
      "revoked",
    );
    expect(s.catalog.search).not.toHaveBeenCalled();
    expect(s.admission.assertAllowed).not.toHaveBeenCalled();
  });
  it("does not invent search pagination and treats a short query as browse", async () => {
    const s = setup();
    await s.service.search({ ...actor, query: " x ", page: 2 });
    expect(s.catalog.search).toHaveBeenLastCalledWith({ query: "", page: 2 });
    await s.service.search({ ...actor, query: "review", page: 8 });
    expect(s.catalog.search).toHaveBeenLastCalledWith({
      query: "review",
      page: 0,
    });
  });
  it("preserves operation identity and injects only the configured profile", async () => {
    const s = setup();
    await s.service.requestScan({
      ...actor,
      candidateId: id,
      operationId: id,
      mode: "static",
    });
    expect(s.store.requestScan).toHaveBeenCalledWith({
      ...actor,
      candidateId: id,
      operationId: id,
      mode: "static",
      profile: scanProfile(),
    });
    await s.service.requestScan({
      ...actor,
      candidateId: id,
      operationId: id,
      mode: "ai",
    });
    // The store may recover an existing receipt even with a disabled profile;
    // only a genuinely new job must refuse unavailable execution.
    expect(s.store.requestScan).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "ai", profile: null }),
    );
  });
  it("keeps browsing available and import receipt recovery possible without a scanner", async () => {
    const s = setup([]);
    expect(await s.service.configuration(actor)).toEqual({
      scanAvailable: false,
      aiAvailable: false,
    });
    await s.service.importCandidate({
      ...actor,
      candidateId: id,
      scanId: id,
      mode: "static",
      acknowledgeWarnings: false,
      acknowledgeOmissions: false,
    });
    expect(s.store.importCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ profile: null }),
    );
  });
  it("validates exact GitHub selections including a root directory", () => {
    expect(
      validateCatalogSelection({
        repository: "owner/repo",
        commit: "a".repeat(40),
        path: "",
      }).path,
    ).toBe("");
    for (const value of [
      "../SKILL.md",
      "/tmp/SKILL.md",
      "x//SKILL.md",
      "x\\file",
    ])
      expect(() =>
        validateCatalogSelection({
          repository: "owner/repo",
          commit: "a".repeat(40),
          path: value,
        }),
      ).toThrow();
    expect(() =>
      validateCatalogSelection({ repository: "https://github.com/owner/repo" }),
    ).toThrow();
  });
  it("canonicalizes GitHub repository case before resolving a catalog selection", async () => {
    const s = setup();
    s.catalog.resolve.mockResolvedValue({ status: "not_found" });
    await s.service.resolve({
      ...actor,
      repository: "NVIDIA/SkillSpector",
      skillNameHint: "Review",
    });
    expect(s.catalog.resolve).toHaveBeenCalledWith({
      repository: "nvidia/skillspector",
      skillNameHint: "Review",
    });
  });
  it("matches UAP UTF-8 selector byte limits without truncating Unicode", () => {
    const hint = "ї".repeat(256),
      path = "я".repeat(2048);
    expect(
      validateCatalogSelection({
        repository: "Owner/Repo",
        skillNameHint: hint,
      }).skillNameHint,
    ).toBe(hint);
    expect(() =>
      validateCatalogSelection({
        repository: "Owner/Repo",
        skillNameHint: hint + "a",
      }),
    ).toThrow();
    expect(
      validateCatalogSelection({
        repository: "Owner/Repo",
        commit: "a".repeat(40),
        path,
      }).path,
    ).toBe(path);
    expect(() =>
      validateCatalogSelection({
        repository: "Owner/Repo",
        commit: "a".repeat(40),
        path: path + "a",
      }),
    ).toThrow();
    expect(() =>
      validateCatalogSelection({
        repository: "Owner/Repo",
        commit: "a".repeat(40),
        path: ".",
      }),
    ).toThrow();
  });
  it("composes the real catalog module with an independent wiring oracle", async () => {
    const declarations = [catalogHostDeclaration, catalogDeclaration];
    checkNamespaces({ namespace: "reviewrouter", declarations });
    const prepared = await composeReviewSkillsCatalog(assemblyFor());
    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared") throw new Error("not prepared");
    checkWiring(
      prepared.composition,
      [
        {
          providers: {
            "reviewrouter/skill-catalog-host":
              "reviewrouter/skill-catalog-host/host",
            "reviewrouter/skill-catalog": "reviewrouter/skill-catalog/default",
          },
          roots: ["reviewrouter/skill-catalog/default"],
        },
      ],
      { declarations },
    );
  });
});
describe("Skills scan execution fencing", () => {
  const claim = {
    jobId: id,
    claimId: "claim-1",
    claimVersion: 1n,
    claimUntil: new Date(Date.now() + 240000),
  };
  const execution = {
    jobId: id,
    attemptId: "claim-1",
    canonicalText: "Review.",
    contentDigest: `sha256:${"a".repeat(64)}`,
    profile: scanProfile(),
    deadlineAt: new Date(Date.now() + 90000).toISOString(),
  };
  it("never invokes the scanner when claim admission is busy", async () => {
    const s = setup();
    s.store.beginScan.mockResolvedValue({ status: "busy" });
    const executor = { scan: vi.fn() };
    expect(
      await processReviewSkillScan(claim, {
        store: s.store,
        profiles: s.profiles,
        executor,
      }),
    ).toBe("busy");
    expect(executor.scan).not.toHaveBeenCalled();
  });
  it("retains the execution slot after uncertain transport failure and does not retry", async () => {
    const s = setup();
    s.store.beginScan.mockResolvedValue({ status: "started", execution });
    const executor = {
      scan: vi.fn().mockRejectedValue(new Error("transport lost")),
    };
    expect(
      await processReviewSkillScan(claim, {
        store: s.store,
        profiles: s.profiles,
        executor,
      }),
    ).toBe("processed");
    expect(executor.scan).toHaveBeenCalledTimes(1);
    expect(s.store.finishScan).toHaveBeenCalledWith({
      ...claim,
      report: { verdict: "incomplete", findings: [] },
      confirmedExit: false,
    });
  });
  it("does not accept a valid report for another attempt or input", async () => {
    const s = setup();
    s.store.beginScan.mockResolvedValue({ status: "started", execution });
    const executor = {
      scan: vi.fn().mockResolvedValue({
        jobId: id,
        attemptId: "other",
        contentDigest: execution.contentDigest,
        profileFingerprint: execution.profile.fingerprint,
        scannerBuildId: execution.profile.scannerBuildId,
        executionFinished: true,
        report: nativeReport(),
      }),
    };
    await processReviewSkillScan(claim, {
      store: s.store,
      profiles: s.profiles,
      executor,
    });
    expect(s.store.finishScan).toHaveBeenCalledWith(
      expect.objectContaining({
        report: { verdict: "incomplete", findings: [] },
      }),
    );
  });
});
