import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  ADR_INDEX_PATH,
  ADR_PATH,
  CLI_PATH,
  PROFILE_PATH,
  checkWebHostCms,
  createFileSystemView,
  parseStrictJson,
  type RepositoryView,
} from "./check-web-host-cms-profile";

// Each mutant breaks one claim of the scoped WEB Host decision (ADR-030) and must turn the check red. The real
// repository files are the baseline; nothing outside this repository is read.
const root = resolve(".");
const real = createFileSystemView(root);
const CI_PATH = ".github/workflows/ci.yml";

function viewWith(
  overrides: Readonly<Record<string, string | null>>,
  extraFiles: readonly string[] = [],
): RepositoryView {
  return {
    read: (path) =>
      path in overrides ? (overrides[path] ?? null) : real.read(path),
    list: () => [...real.list(), ...extraFiles],
  };
}

function profileWith(mutate: (profile: Record<string, any>) => void): string {
  const profile = JSON.parse(real.read(PROFILE_PATH) ?? "{}") as Record<
    string,
    any
  >;
  mutate(profile);
  return JSON.stringify(profile, null, 2);
}

function expectRejected(view: RepositoryView, pattern: RegExp): void {
  const violations = checkWebHostCms(view);
  expect(violations.length).toBeGreaterThan(0);
  expect(violations.join("\n")).toMatch(pattern);
}

function packageWith(
  mutate: (scripts: Record<string, string>) => void,
): string {
  const manifest = JSON.parse(real.read("package.json") ?? "{}") as {
    scripts: Record<string, string>;
  };
  mutate(manifest.scripts);
  return JSON.stringify(manifest, null, 2);
}

describe("WEB Host CMS profile gate (ADR-030)", () => {
  it("accepts the repository as committed", () => {
    expect(checkWebHostCms(real)).toEqual([]);
  });

  it("is wired into architecture:check and CI without a fallback", () => {
    const scripts = (
      JSON.parse(real.read("package.json") ?? "{}") as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts["architecture:check"]).toBe(
      "node scripts/check-architecture-boundaries.mjs && pnpm architecture:web-host-cms && pnpm foundation:check && pnpm foundation:assert-dev-only && pnpm foundation:assert-registry && pnpm foundation:qualify-memory && pnpm foundation:qualify-statistics && pnpm history:architecture",
    );
    expect(scripts["architecture:web-host-cms"]).toBe(
      "tsx scripts/check-web-host-cms-profile-cli.ts",
    );
    expect(real.read(CI_PATH)).toMatch(
      /name: Architecture boundaries\s*\n\s+run: pnpm architecture:check/u,
    );
  });

  describe("fixed standards", () => {
    const cases: ReadonlyArray<[string, (p: Record<string, any>) => void]> = [
      [
        "moving branch instead of a commit",
        (p) => (p.authority.consumerModuleStandard.commit = "main"),
      ],
      [
        "Consumer Module Standard document sha",
        (p) =>
          (p.authority.consumerModuleStandard.documentSha256 = "0".repeat(64)),
      ],
      [
        "Consumer Module Standard blob",
        (p) => (p.authority.consumerModuleStandard.gitBlob = "1".repeat(40)),
      ],
      [
        "Consumer Module Standard size",
        (p) => (p.authority.consumerModuleStandard.bytes = 54679),
      ],
      [
        "prior standard reused as current",
        (p) =>
          (p.authority.consumerModuleStandard.commit =
            p.authority.priorStandard.commit),
      ],
      [
        "shared delta diff sha",
        (p) => (p.authority.sharedDelta.diffSha256 = "2".repeat(64)),
      ],
      [
        "Feature Module Standard sha",
        (p) => (p.authority.featureModuleStandard.sha256 = "3".repeat(64)),
      ],
      [
        "EQS commit",
        (p) => (p.authority.engineeringQualityStandard.commit = "4".repeat(40)),
      ],
      [
        "EQS blob",
        (p) =>
          (p.authority.engineeringQualityStandard.gitBlob = "5".repeat(40)),
      ],
      [
        "EQS size",
        (p) => (p.authority.engineeringQualityStandard.bytes = 18079),
      ],
      [
        "EQS sha",
        (p) => (p.authority.engineeringQualityStandard.sha256 = "6".repeat(64)),
      ],
      ["EQS pin removed", (p) => delete p.authority.engineeringQualityStandard],
    ];
    it.each(cases)("rejects a wrong pin: %s", (_label, mutate) => {
      expectRejected(
        viewWith({ [PROFILE_PATH]: profileWith(mutate) }),
        /authority\./u,
      );
    });
  });

  describe("delivery authority", () => {
    const cases: ReadonlyArray<[string, (p: Record<string, any>) => void]> = [
      [
        "operation",
        (p) => (p.hostSlice.operation = "11111111-1111-4111-8111-111111111111"),
      ],
      [
        "native tuple ready53",
        (p) =>
          (p.hostSlice.native = ["ready", 53, p.hostSlice.operation, false]),
      ],
      [
        "release name",
        (p) =>
          (p.hostSlice.release =
            "existing-web-trust-overlap-successor-20261011-v26web-c8"),
      ],
      ["root sha", (p) => (p.hostSlice.rootSha256 = "7".repeat(64))],
      ["control sha", (p) => (p.hostSlice.controlSha256 = "8".repeat(64))],
      [
        "sealed manifest sha",
        (p) => (p.hostSlice.mixedManifestSha256 = "9".repeat(64)),
      ],
      ["startup sha", (p) => (p.hostSlice.startupSha256 = "a".repeat(64))],
      [
        "publication sha",
        (p) => (p.hostSlice.publication.sha256 = "b".repeat(64)),
      ],
      ["publication size", (p) => (p.hostSlice.publication.bytes = 600)],
      ["publication mode", (p) => (p.hostSlice.publication.mode = "0644")],
      [
        "prior API operation",
        (p) =>
          (p.hostSlice.priorApiOperation =
            "22222222-2222-4222-8222-222222222222"),
      ],
      [
        "installer sha is not a digest",
        (p) => (p.hostSlice.installerSha256 = "short"),
      ],
      [
        "closure file removed",
        (p) => delete p.hostSlice.installedClosure.releaseFiles["warm.sh"],
      ],
      [
        "sealed factory module missing",
        (p) =>
          delete p.hostSlice.installedClosure.releaseFiles[
            "web_trust_finished_context.py"
          ],
      ],
      ["hostSlice made a graph node", (p) => (p.hostSlice.graphNode = true)],
    ];
    it.each(cases)("rejects a mismatch: %s", (_label, mutate) => {
      expectRejected(
        viewWith({ [PROFILE_PATH]: profileWith(mutate) }),
        /hostSlice|factory boundary|installed (?:release )?closure/u,
      );
    });
  });

  describe("boundaries and the factory", () => {
    const cases: ReadonlyArray<
      [string, (p: Record<string, any>) => void, RegExp]
    > = [
      [
        "undeclared boundary",
        (p) =>
          p.boundaries.push({
            id: "web-trust-extra",
            classification: "x",
            graphNode: false,
          }),
        /undeclared boundary/u,
      ],
      [
        "declared boundary removed",
        (p) => p.boundaries.pop(),
        /missing or reclassified/u,
      ],
      [
        "boundary reclassified",
        (p) => (p.boundaries[0].classification = "graph-node"),
        /missing or reclassified/u,
      ],
      [
        "boundary becomes a graph node",
        (p) => (p.boundaries[3].graphNode = true),
        /graph node/u,
      ],
      [
        "factory class chain changed",
        (p) => (p.factoryBoundary.identity.classChain = ["Schema125Context"]),
        /factory identity/u,
      ],
      [
        "factory defining module changed",
        (p) =>
          (p.factoryBoundary.identity.definingModules[0] = "foreign_module"),
        /factory identity/u,
      ],
      [
        "factory sealed module changed",
        (p) => (p.factoryBoundary.identity.sealedModule = "other.py"),
        /factory identity/u,
      ],
      [
        "public initializer renamed",
        (p) => (p.factoryBoundary.publicInitializer = "initialize"),
        /public initializer/u,
      ],
      [
        "dependency direction reversed",
        (p) => (p.factoryBoundary.dependencyDirection = "factory -> WEB"),
        /dependency direction/u,
      ],
      [
        "factory refusals dropped",
        (p) => (p.factoryBoundary.refusals = []),
        /refusals/u,
      ],
      [
        "exception recorded",
        (p) => p.exceptions.push({ rule: "r" }),
        /exception/u,
      ],
      [
        "legacy adopted silently",
        (p) => (p.legacy[0].status = "adopted"),
        /not-adopted/u,
      ],
      [
        "assembly gates declared without a gate",
        (p) => (p.conditionalAssemblyGates.declared = true),
        /Assembly gates/u,
      ],
      [
        "product source declared in the repository",
        (p) => (p.scope.productSourceInRepository = true),
        /productSourceInRepository/u,
      ],
    ];
    it.each(cases)("rejects: %s", (_label, mutate, pattern) => {
      expectRejected(
        viewWith({ [PROFILE_PATH]: profileWith(mutate) }),
        pattern,
      );
    });

    it("rejects an undeclared WEB Host file in the repository", () => {
      expectRejected(
        viewWith({}, ["apps/worker/web_trust_loader.py"]),
        /undeclared WEB Host boundary file/u,
      );
      expectRejected(
        viewWith({}, ["ops/web-trust-overlap-v26-c11-root.py"]),
        /undeclared WEB Host boundary file/u,
      );
    });

    it("rejects a declared but absent WEB Host path", () => {
      expectRejected(
        viewWith({
          [PROFILE_PATH]: profileWith((p) =>
            p.scope.governedPaths.push("web_trust_ghost.py"),
          ),
        }),
        /does not exist/u,
      );
    });
  });

  describe("claims and qualification", () => {
    const cases: ReadonlyArray<
      [string, (p: Record<string, any>) => void, RegExp]
    > = [
      [
        "organization-wide adoption claimed",
        (p) => (p.scope.organizationWideAdoption = true),
        /organizationWideAdoption/u,
      ],
      [
        "Node26 qualification claimed",
        (p) => (p.scope.node26Qualification = true),
        /node26Qualification/u,
      ],
      [
        "full product CI claimed",
        (p) => (p.scope.fullProductCi = true),
        /fullProductCi/u,
      ],
      [
        "installed gate no longer an operator gate",
        (p) => (p.qualification.installedGate.kind = "ci"),
        /operator gate/u,
      ],
      [
        "installed gate command is a no-op",
        (p) => (p.qualification.installedGate.command = "echo ok"),
        /no-op/u,
      ],
      [
        "installed gate command chained into a fallback",
        (p) => (p.qualification.installedGate.command += " || true"),
        /no-op/u,
      ],
      [
        "passed installed gate without a receipt",
        (p) => (p.qualification.installedGate.receipt = null),
        /receipt/u,
      ],
      [
        "passed installed gate with a receipt lacking its digest",
        (p) => delete p.qualification.installedGate.receipt.sha256,
        /receipt/u,
      ],
      [
        "passed installed gate with a malformed digest",
        (p) => (p.qualification.installedGate.receipt.sha256 = "short"),
        /receipt sha256 differs/u,
      ],
      [
        "another valid-looking receipt digest",
        (p) => (p.qualification.installedGate.receipt.sha256 = "e".repeat(64)),
        /receipt sha256 differs/u,
      ],
      [
        "another receipt reference",
        (p) =>
          (p.qualification.installedGate.receipt.reference =
            "other-receipt.json"),
        /receipt reference differs/u,
      ],
      [
        "receipt with an extra key",
        (p) => (p.qualification.installedGate.receipt.path = "x"),
        /exactly a receipt reference/u,
      ],
      [
        "receipt projection removed",
        (p) => delete p.qualification.installedGate.receipt.projection,
        /exactly a receipt reference/u,
      ],
      [
        "receipt projection field removed",
        (p) => delete p.qualification.installedGate.receipt.projection.native,
        /genuine receipt fields/u,
      ],
      [
        "receipt projection with an invented field",
        (p) =>
          (p.qualification.installedGate.receipt.projection.readOnly = true),
        /genuine receipt fields/u,
      ],
      [
        "receipt status",
        (p) =>
          (p.qualification.installedGate.receipt.projection.status =
            "cms-delivery-gate-fail"),
        /projection status differs/u,
      ],
      [
        "receipt return code",
        (p) =>
          (p.qualification.installedGate.receipt.projection.returncode = 1),
        /projection returncode differs/u,
      ],
      [
        "receipt native state ready53",
        (p) =>
          (p.qualification.installedGate.receipt.projection.native = [
            "ready",
            53,
            "868258c2-9846-474b-8365-84fce37cc576",
            false,
          ]),
        /projection native differs/u,
      ],
      [
        "receipt operation",
        (p) =>
          (p.qualification.installedGate.receipt.projection.native[2] =
            "11111111-1111-4111-8111-111111111111"),
        /projection native differs/u,
      ],
      [
        "receipt standard commit",
        (p) =>
          (p.qualification.installedGate.receipt.projection.standardCommit =
            "d6127e2d3f499b91b220a222fc3672d29dff1ab2"),
        /projection standardCommit differs/u,
      ],
      [
        "receipt adoption no longer pending",
        (p) =>
          (p.qualification.installedGate.receipt.projection.cmsAdoption =
            "adopted"),
        /projection cmsAdoption differs/u,
      ],
      [
        "receipt production adoption",
        (p) =>
          (p.qualification.installedGate.receipt.projection.productionAdoption = true),
        /projection productionAdoption differs/u,
      ],
      [
        "receipt organization-wide qualification",
        (p) =>
          (p.qualification.installedGate.receipt.projection.wholeOrganizationQualification = true),
        /projection wholeOrganizationQualification differs/u,
      ],
      [
        "receipt read-only evidence (noActivationReplay)",
        (p) =>
          (p.qualification.installedGate.receipt.projection.noActivationReplay = false),
        /projection noActivationReplay differs/u,
      ],
      [
        "receipt packet manifest digest",
        (p) =>
          (p.qualification.installedGate.receipt.projection.packetManifestSha256 =
            "f".repeat(64)),
        /projection packetManifestSha256 differs/u,
      ],
      [
        "receipt unverified list emptied",
        (p) =>
          (p.qualification.installedGate.receipt.projection.unverified = []),
        /projection unverified differs/u,
      ],
      [
        "pending installed gate carrying a receipt",
        (p) => (p.qualification.installedGate.status = "operator-run-pending"),
        /pending installed gate/u,
      ],
      [
        "unknown installed gate status",
        (p) => (p.qualification.installedGate.status = "proven-by-ci"),
        /not recognised/u,
      ],
      [
        "deterministic gate script changed",
        (p) => (p.qualification.deterministicGate.script = "scripts/other.ts"),
        /deterministic gate/u,
      ],
      [
        "deterministic gate no longer states its limits",
        (p) => (p.qualification.deterministicGate.doesNotProve = ""),
        /does not prove/u,
      ],
      [
        "decision reference changed",
        (p) => (p.decision.adr = "ADR-031"),
        /ADR-030/u,
      ],
      [
        "decision status widened",
        (p) => (p.decision.status = "adopted"),
        /ADR-030/u,
      ],
    ];
    it.each(cases)("rejects: %s", (_label, mutate, pattern) => {
      expectRejected(
        viewWith({ [PROFILE_PATH]: profileWith(mutate) }),
        pattern,
      );
    });

    it("references the accepted installed receipt by hash and a finite projection, with no execution record", () => {
      const text = real.read(PROFILE_PATH) ?? "";
      const profile = JSON.parse(text);
      const gate = profile.qualification.installedGate;
      expect(gate.status).toBe("operator-run-passed");
      expect(gate.receipt.sha256).toBe(
        "121108083bc53d95d006b1d725952ba02c704c015c68b4d72917676c411a043a",
      );
      expect(gate.receipt.projection.native).toEqual([
        "ready",
        54,
        "868258c2-9846-474b-8365-84fce37cc576",
        false,
      ]);
      expect(gate.receipt.projection).toMatchObject({
        cmsAdoption: "pending",
        productionAdoption: false,
        wholeOrganizationQualification: false,
        noActivationReplay: true,
      });
      // the source profile never fingerprints its own execution (counts, input hashes, tool versions)
      expect(profile.qualification.focusedChecks).toBeUndefined();
      expect(text).not.toMatch(
        /sourcePacketSha256|semanticInputSha256|tests PASS|\d+ of \d+/u,
      );
    });
  });

  describe("decision record and index", () => {
    const adr = real.read(ADR_PATH) ?? "";
    it("rejects a missing decision record", () => {
      expectRejected(viewWith({ [ADR_PATH]: null }), /is missing/u);
    });

    it.each([
      ["standard commit", "4728b276b87378ca9d72a7be2b89a5fd49b97eea"],
      [
        "document sha",
        "859fbca1e8a0c61b6ae873bea0057735a55b80230100e6e73a74de22e123165a",
      ],
      ["EQS commit", "66d6d3d2c2643edac414ded48c0ee0586774dd07"],
      [
        "EQS sha",
        "d55f9f498da213dfa7b14aeac5df5b2fcf37b2cfed4c63dd88b51bde6f56ebe8",
      ],
      ["operation", "868258c2-9846-474b-8365-84fce37cc576"],
      [
        "publication sha",
        "71b8009e45462de000502e3793e3ea1748de49b1df1aa0b92fe95fef99f15c22",
      ],
      ["scope exclusion", "Node26 qualification: not claimed."],
      ["accepted status", "Accepted, scoped"],
    ])("rejects a decision record that drops the %s", (_label, needle) => {
      expectRejected(
        viewWith({ [ADR_PATH]: adr.split(needle).join("[dropped]") }),
        /does not state/u,
      );
    });

    it("rejects a decision record that claims more than the slice", () => {
      expectRejected(
        viewWith({
          [ADR_PATH]: `${adr}\nOrganization-wide adoption: accepted.\n`,
        }),
        /claims more/u,
      );
    });

    it("rejects an index without the decision", () => {
      const index = real.read(ADR_INDEX_PATH) ?? "";
      expectRejected(
        viewWith({
          [ADR_INDEX_PATH]: index.replace(
            "(./030-web-trust-host-consumer-module-standard-scope.md)",
            "(./029-opt-in-hosted-workspace-account-pool.md)",
          ),
        }),
        /decision index/u,
      );
    });
  });

  describe("hook wiring", () => {
    it("rejects architecture:check without the WEB Host gate", () => {
      expectRejected(
        viewWith({
          "package.json": packageWith(
            (s) =>
              (s["architecture:check"] =
                "node scripts/check-architecture-boundaries.mjs"),
          ),
        }),
        /architecture:check must chain/u,
      );
    });

    it("rejects a fallback or no-op in the chain", () => {
      for (const chain of [
        "node scripts/check-architecture-boundaries.mjs && pnpm architecture:web-host-cms || true",
        "node scripts/check-architecture-boundaries.mjs && pnpm architecture:web-host-cms; echo done",
        "node scripts/check-architecture-boundaries.mjs && echo pnpm architecture:web-host-cms",
      ]) {
        expectRejected(
          viewWith({
            "package.json": packageWith(
              (s) => (s["architecture:check"] = chain),
            ),
          }),
          /architecture:check must chain/u,
        );
      }
    });

    it("rejects a replaced or missing focused script", () => {
      expectRejected(
        viewWith({
          "package.json": packageWith(
            (s) => (s["architecture:web-host-cms"] = "echo ok"),
          ),
        }),
        /must be exactly/u,
      );
      expectRejected(
        viewWith({
          "package.json": packageWith(
            (s) => delete s["architecture:web-host-cms"],
          ),
        }),
        /must be exactly/u,
      );
    });

    it("rejects CI that no longer runs architecture:check", () => {
      const workflow = real.read(CI_PATH) ?? "";
      expectRejected(
        viewWith({
          [CI_PATH]: workflow.replace(
            "run: pnpm architecture:check",
            "run: pnpm lint",
          ),
        }),
        /CI no longer runs/u,
      );
      expectRejected(viewWith({ [CI_PATH]: null }), /CI no longer runs/u);
    });
  });

  describe("process entry point", () => {
    const cli = real.read(CLI_PATH) ?? "";
    const scratch: string[] = [];
    afterAll(() => {
      for (const directory of scratch.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
      }
    });

    function runCli(
      entry: string,
      workdir: string,
      env?: Record<string, string>,
    ) {
      return spawnSync(process.execPath, ["--import", "tsx", entry], {
        cwd: workdir,
        encoding: "utf8",
        timeout: 90_000,
        env: { ...process.env, ...env },
      });
    }

    // A copy of the actual library, CLI and governed files in a temporary root: the CLI derives its root from its own
    // location, so a defect in that copy is judged by the real process without any root override.
    function copiedRoot(
      mutateProfile?: (profile: Record<string, any>) => void,
    ): string {
      const directory = mkdtempSync(join(tmpdir(), "rr-web-host-cms-"));
      scratch.push(directory);
      const copied = [
        CLI_PATH,
        "scripts/check-web-host-cms-profile.ts",
        PROFILE_PATH,
        ADR_PATH,
        ADR_INDEX_PATH,
        "package.json",
        CI_PATH,
      ];
      for (const path of copied) {
        mkdirSync(dirname(join(directory, path)), { recursive: true });
        copyFileSync(join(root, path), join(directory, path));
      }
      if (mutateProfile) {
        const profile = JSON.parse(real.read(PROFILE_PATH) ?? "{}") as Record<
          string,
          any
        >;
        mutateProfile(profile);
        writeFileSync(
          join(directory, PROFILE_PATH),
          JSON.stringify(profile, null, 2),
        );
      }
      symlinkSync(
        join(root, "node_modules"),
        join(directory, "node_modules"),
        "dir",
      );
      return directory;
    }

    it("passes on the repository it lives in and prints a real PASS line", () => {
      const result = runCli(resolve(root, CLI_PATH), root);
      expect(result.stderr).not.toMatch(/violations/u);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/WEB Host CMS profile check passed/u);
    }, 120_000);

    it("exits 1 with the violation list on a rejected tree", () => {
      const directory = copiedRoot((profile) => {
        profile.authority.engineeringQualityStandard.commit = "4".repeat(40);
      });
      const result = runCli(join(directory, CLI_PATH), directory);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/WEB Host CMS profile violations/u);
      expect(result.stderr).toMatch(
        /authority\.engineeringQualityStandard\.commit/u,
      );
    }, 120_000);

    it("exits 1 on an altered installed-gate receipt projection", () => {
      const directory = copiedRoot((profile) => {
        profile.qualification.installedGate.receipt.projection.native[1] = 53;
      });
      const result = runCli(join(directory, CLI_PATH), directory);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/projection native differs/u);
    }, 120_000);

    it("passes on a faithful copy, so the failures above come from the altered profile only", () => {
      const directory = copiedRoot();
      const result = runCli(join(directory, CLI_PATH), directory);
      expect(result.stderr).not.toMatch(/violations/u);
      expect(result.status).toBe(0);
    }, 120_000);

    it("ignores any environment attempt to point it at another tree", () => {
      const bad = copiedRoot((profile) => {
        profile.scope.organizationWideAdoption = true;
      });
      const result = runCli(resolve(root, CLI_PATH), root, {
        REVIEWROUTER_CMS_ROOT: bad,
        REVIEWROUTER_ARCHITECTURE_ROOT: bad,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/passed/u);
    }, 120_000);

    it("keeps the entry point unconditional and root-fixed", () => {
      expect(cli).toContain("checkWebHostCms(");
      expect(cli).not.toMatch(/process\.env|process\.argv/u);
      expectRejected(
        viewWith({ [CLI_PATH]: cli.replace("process.exitCode = 1", "") }),
        /does not fail the process/u,
      );
      expectRejected(
        viewWith({
          [CLI_PATH]: `${cli}\nconst override = process.env.REVIEWROUTER_CMS_ROOT;\n`,
        }),
        /must not read the environment or argv/u,
      );
      expectRejected(
        viewWith({
          [CLI_PATH]: `if (process.argv[1]?.endsWith("cli.ts")) {\n${cli}\n}\n`,
        }),
        /must not read the environment or argv/u,
      );
      expectRejected(
        viewWith({ [CLI_PATH]: `if (import.meta.url === "x") {\n${cli}\n}\n` }),
        /main-module condition/u,
      );
      expectRejected(
        viewWith({ [CLI_PATH]: cli.replace("checkWebHostCms(", "noop(") }),
        /does not run the pure check/u,
      );
      expectRejected(
        viewWith({ [CLI_PATH]: null }),
        /check-web-host-cms-profile-cli\.ts is missing/u,
      );
    });
  });

  describe("strict profile parsing", () => {
    it("rejects duplicate keys, trailing data and non-JSON", () => {
      const text = real.read(PROFILE_PATH) ?? "";
      expect(() => parseStrictJson('{"a":1,"a":2}')).toThrow(/duplicate key/u);
      expect(() => parseStrictJson("{}{}")).toThrow(/trailing data/u);
      expectRejected(
        viewWith({
          [PROFILE_PATH]: text.replace('"schema":', '"schema": "x", "schema":'),
        }),
        /not strict JSON/u,
      );
      expectRejected(
        viewWith({ [PROFILE_PATH]: "not json" }),
        /not strict JSON/u,
      );
      expectRejected(viewWith({ [PROFILE_PATH]: null }), /is missing/u);
    });
  });

  it("does not depend on absolute private evidence paths", () => {
    const source = real.read("scripts/check-web-host-cms-profile.ts") ?? "";
    const entry = real.read(CLI_PATH) ?? "";
    const profile = real.read(PROFILE_PATH) ?? "";
    for (const text of [source, entry, profile]) {
      expect(text).not.toMatch(/plans\/evidence|\/Users\/|TEST-/u);
    }
  });
});
