import {
  lifecycleVerificationContract,
  lifecycleVerificationDescriptorDigest,
} from "../packages/protocol-review-action-v2/src/generated/companion-contracts.js";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkReleaseManifest } from "./check-public-review-action-v2-release-manifest.mjs";
import {
  exportPublicContract,
  parseArgs as parseExportArgs,
} from "./export-public-review-action-v2-contract.mjs";
import {
  generateReleaseManifest,
  parseArgs as parseReleaseArgs,
} from "./generate-public-review-action-v2-release-manifest.mjs";
import {
  canonicalJson,
  HANDOFF_MANIFEST_FILE,
  parseHandoffManifest,
  PUBLIC_CONTEXT_GATEWAY_RELEASE_METADATA,
  PUBLIC_GENERATED_DIRECTORY,
  REVIEW_INVESTIGATION_RELEASE_CAPABILITY,
  REVIEW_INVESTIGATION_RELEASE_COVERAGE_PROFILE_HASH,
  REVIEW_INVESTIGATION_RELEASE_POLICY_HASH,
  sha256Digest,
  parseReleaseManifest,
  buildReleaseRegistrationCandidateFields,
} from "./lib/review-action-v2-release-manifests.mjs";

const temporaryDirectories: string[] = [];
const sourceDirectory = "generated-contract";
const targetBranch = "feat/review-action-v2-contract";
const fixtureRoot = join(
  process.cwd(),
  "scripts/fixtures/review-action-v2-release",
);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("public Review Action v2 contract handoff", () => {
  it("hands off the finite conversation wire contract as a managed digest-bound artifact", async () => {
    const fixture = createRepositories();
    const bytes = readFileSync(
      join(
        process.cwd(),
        "packages/protocol-review-action-v2/src/conversation.ts",
      ),
      "utf8",
    );
    write(join(fixture.saasRepo, sourceDirectory, "conversation.ts"), bytes);
    git(fixture.saasRepo, ["add", sourceDirectory]);
    git(fixture.saasRepo, [
      "commit",
      "-m",
      "test: add finite conversation contract",
    ]);
    const saasHead = git(fixture.saasRepo, ["rev-parse", "HEAD"]);
    const actionHead = git(fixture.actionRepo, ["rev-parse", "HEAD"]);
    await exportPublicContract({
      saasRepo: fixture.saasRepo,
      actionRepo: fixture.actionRepo,
      sourceDirectory,
      targetBranch,
      expectedHead: actionHead,
      expectedSaasHead: saasHead,
      write: true,
    });
    const generatedRoot = join(fixture.actionRepo, PUBLIC_GENERATED_DIRECTORY);
    expect(readFileSync(join(generatedRoot, "conversation.ts"), "utf8")).toBe(
      bytes,
    );
    const manifest = parseHandoffManifest(
      readFileSync(join(generatedRoot, HANDOFF_MANIFEST_FILE), "utf8"),
    );
    expect(manifest.generatedFileDigests["conversation.ts"]).toBe(
      sha256Digest(Buffer.from(bytes)),
    );
  });

  it("hands off the canonical usage v1 validator and dependency as managed digest-bound artifacts", async () => {
    const fixture = createRepositories();
    for (const file of [
      "usage-v1.ts",
      "usage-price-v1.ts",
      "usage-producer-v1.ts",
      "usage-responses-v1.ts",
    ]) {
      write(
        join(fixture.saasRepo, sourceDirectory, file),
        readFileSync(
          join(
            process.cwd(),
            "packages/protocol-review-action-v2/src/generated",
            file,
          ),
          "utf8",
        ),
      );
    }
    git(fixture.saasRepo, ["add", sourceDirectory]);
    git(fixture.saasRepo, [
      "commit",
      "-m",
      "test: add generated usage contract",
    ]);
    fixture.saasHead = head(fixture.saasRepo);
    const result = await exportFixture(fixture, { write: true });
    for (const file of [
      "usage-v1.ts",
      "usage-price-v1.ts",
      "usage-producer-v1.ts",
      "usage-responses-v1.ts",
    ]) {
      const contents = readFileSync(
        join(fixture.actionRepo, PUBLIC_GENERATED_DIRECTORY, file),
      );
      expect(
        contents.equals(
          readFileSync(join(fixture.saasRepo, sourceDirectory, file)),
        ),
      ).toBe(true);
      expect(JSON.stringify(result.handoff)).toContain(sha256Digest(contents));
    }
  });

  it("exports, commits, generates, and verifies one immutable release", async () => {
    const fixture = createRepositories();
    const exported = await exportFixture(fixture, { write: true });
    expect(exported.handoff.saasSourceCommit).toBe(fixture.saasHead);
    expect(exported.handoff.expectedPublicActionBaseCommit).toBe(
      fixture.actionBase,
    );

    const targetRoot = join(
      fixture.actionRepo,
      ...PUBLIC_GENERATED_DIRECTORY.split("/"),
    );
    const handoff = parseHandoffManifest(
      readFileSync(join(targetRoot, HANDOFF_MANIFEST_FILE), "utf8"),
    );
    expect(Object.keys(handoff.generatedFileDigests)).toEqual([
      "canonicalizer.js",
      "golden/unsupported-protocol.json",
      "manifest.json",
      "schema.json",
    ]);

    write(join(fixture.actionRepo, "dist/index.js"), "fresh bundle\n");
    write(
      join(fixture.actionRepo, "dist/context-gateway.js"),
      "fresh context gateway\n",
    );
    writeContextGatewayReleaseMetadata(fixture.actionRepo);
    git(fixture.actionRepo, [
      "add",
      PUBLIC_GENERATED_DIRECTORY,
      "dist/index.js",
      "dist/context-gateway.js",
      PUBLIC_CONTEXT_GATEWAY_RELEASE_METADATA,
    ]);
    git(fixture.actionRepo, ["commit", "-m", "feat: add v2 contract"]);
    const actionCommit = head(fixture.actionRepo);
    const releasePath = join(fixture.root, "release-manifest.json");
    const release = generateReleaseManifest({
      actionRepo: fixture.actionRepo,
      targetBranch,
      expectedHead: actionCommit,
      runtimeEntrypointPath: "dist/index.js",
      contextGatewayEntrypointPath: "dist/context-gateway.js",
      output: releasePath,
    });
    expect(release.manifest.actionCommitSha).toBe(actionCommit);
    expect(release.manifest.runtimeCommitSha).toBe(actionCommit);
    expect(
      checkReleaseManifest({
        manifest: releasePath,
        saasRepo: fixture.saasRepo,
        actionRepo: fixture.actionRepo,
        sourceDirectory,
      }),
    ).toMatchObject({
      saasSourceCommit: fixture.saasHead,
      actionCommitSha: actionCommit,
    });

    const tamperedReleasePath = join(
      fixture.root,
      "tampered-release-manifest.json",
    );
    const tamperedRelease = JSON.parse(release.bytes);
    tamperedRelease.contextGatewayPolicyVersion = "operator-supplied-wrong-v9";
    writeFileSync(tamperedReleasePath, canonicalJson(tamperedRelease));
    expect(() =>
      checkReleaseManifest({
        manifest: tamperedReleasePath,
        saasRepo: fixture.saasRepo,
        actionRepo: fixture.actionRepo,
        sourceDirectory,
      }),
    ).toThrow("cannot claim investigation capability");

    expect(
      generateReleaseManifest({
        actionRepo: fixture.actionRepo,
        targetBranch,
        expectedHead: actionCommit,
        runtimeEntrypointPath: "dist/index.js",
        contextGatewayEntrypointPath: "dist/context-gateway.js",
        output: releasePath,
      }).bytes,
    ).toBe(release.bytes);
    writeFileSync(releasePath, "different\n");
    expect(() =>
      generateReleaseManifest({
        actionRepo: fixture.actionRepo,
        targetBranch,
        expectedHead: actionCommit,
        runtimeEntrypointPath: "dist/index.js",
        contextGatewayEntrypointPath: "dist/context-gateway.js",
        output: releasePath,
      }),
    ).toThrow("refusing to overwrite a different release manifest");
  });

  it.each(["supported", "unsupported", "unbound"] as const)(
    "projects handoff-bound lifecycle bytes through normal release registration (%s)",
    async (kind) => {
      const fixture = createRepositories();
      const companion = readFileSync(
        join(
          process.cwd(),
          "packages/protocol-review-action-v2/src/generated/companion-contracts.ts",
        ),
        "utf8",
      );
      write(
        join(fixture.saasRepo, sourceDirectory, "companion-contracts.ts"),
        kind === "unsupported"
          ? companion.replace(
              "lifecycle-verification.v1",
              "lifecycle-verification.v2",
            )
          : companion,
      );
      git(fixture.saasRepo, ["add", sourceDirectory]);
      git(fixture.saasRepo, ["commit", "-m", "test: bind lifecycle contract"]);
      fixture.saasHead = head(fixture.saasRepo);
      await exportFixture(fixture, { write: true });
      if (kind === "unbound")
        write(
          join(
            fixture.actionRepo,
            PUBLIC_GENERATED_DIRECTORY,
            "companion-contracts.ts",
          ),
          companion + "\n",
        );
      write(join(fixture.actionRepo, "dist/index.js"), "fresh bundle\n");
      write(
        join(fixture.actionRepo, "dist/context-gateway.js"),
        "fresh context gateway\n",
      );
      writeContextGatewayReleaseMetadata(fixture.actionRepo);
      git(fixture.actionRepo, ["add", PUBLIC_GENERATED_DIRECTORY, "dist"]);
      git(fixture.actionRepo, [
        "commit",
        "-m",
        "test: release lifecycle contract",
      ]);
      const input = {
        actionRepo: fixture.actionRepo,
        targetBranch,
        expectedHead: head(fixture.actionRepo),
        runtimeEntrypointPath: "dist/index.js",
        contextGatewayEntrypointPath: "dist/context-gateway.js",
        output: join(fixture.root, "lifecycle-release.json"),
      };
      if (kind !== "supported") {
        expect(() => generateReleaseManifest(input)).toThrow(
          kind === "unbound"
            ? "committed generated file digest mismatch"
            : "unsupported lifecycle verification companion contract bytes",
        );
        return;
      }
      const release = generateReleaseManifest(input);
      const expectedProfile = {
        extensionId: lifecycleVerificationContract.extensionId,
        descriptorDigest: lifecycleVerificationDescriptorDigest,
      };
      expect(release.manifest.lifecycleVerificationProfile).toEqual(
        expectedProfile,
      );
      expect(parseReleaseManifest(release.bytes)).toEqual(release.manifest);
      expect(
        buildReleaseRegistrationCandidateFields(release.manifest)
          .lifecycleVerificationProfile,
      ).toEqual(expectedProfile);
      expect(
        checkReleaseManifest({
          manifest: input.output,
          saasRepo: fixture.saasRepo,
          actionRepo: fixture.actionRepo,
          sourceDirectory,
        }).lifecycleVerificationProfile,
      ).toEqual(expectedProfile);
      expect(
        JSON.parse(
          readFileSync(
            join(
              fixture.actionRepo,
              PUBLIC_GENERATED_DIRECTORY,
              "manifest.json",
            ),
            "utf8",
          ),
        ),
      ).not.toHaveProperty("lifecycleVerificationProfile");
    },
  );

  it("qualifies PR description approval from committed generated metadata and rejects a rewritten claim", async () => {
    const fixture = createRepositories();
    const profile = {
      extensionId: "pr-description.v1",
      canonicalizerDigest:
        "aa043184eb0a1a0cf230d8fbb03c6a63a05b950c82c0107bee7d2533c386eed0",
    };
    const sourceManifestPath = join(
      fixture.saasRepo,
      sourceDirectory,
      "manifest.json",
    );
    write(
      sourceManifestPath,
      canonicalJson({
        ...JSON.parse(readFileSync(sourceManifestPath, "utf8")),
        auxiliaryExtensions: [profile],
      }),
    );
    git(fixture.saasRepo, ["add", sourceDirectory]);
    git(fixture.saasRepo, [
      "commit",
      "-m",
      "test: approve PR description extension",
    ]);
    fixture.saasHead = head(fixture.saasRepo);
    await exportFixture(fixture, { write: true });
    write(join(fixture.actionRepo, "dist/index.js"), "fresh bundle\n");
    write(
      join(fixture.actionRepo, "dist/context-gateway.js"),
      "fresh context gateway\n",
    );
    writeContextGatewayReleaseMetadata(fixture.actionRepo);
    git(fixture.actionRepo, [
      "add",
      PUBLIC_GENERATED_DIRECTORY,
      "dist/index.js",
      "dist/context-gateway.js",
      PUBLIC_CONTEXT_GATEWAY_RELEASE_METADATA,
    ]);
    git(fixture.actionRepo, [
      "commit",
      "-m",
      "test: bind approved extension release",
    ]);
    const releasePath = join(fixture.root, "description-release.json");
    const release = generateReleaseManifest({
      actionRepo: fixture.actionRepo,
      targetBranch,
      expectedHead: head(fixture.actionRepo),
      runtimeEntrypointPath: "dist/index.js",
      contextGatewayEntrypointPath: "dist/context-gateway.js",
      output: releasePath,
    });
    expect(release.manifest.prDescriptionProfile).toEqual(profile);
    const checkInput = {
      manifest: releasePath,
      saasRepo: fixture.saasRepo,
      actionRepo: fixture.actionRepo,
      sourceDirectory,
    };
    expect(checkReleaseManifest(checkInput).prDescriptionProfile).toEqual(
      profile,
    );
    write(
      releasePath,
      canonicalJson({
        ...release.manifest,
        prDescriptionProfile: {
          ...profile,
          canonicalizerDigest: "f".repeat(64),
        },
      }),
    );
    expect(() => checkReleaseManifest(checkInput)).toThrow(
      "release manifest does not match committed source",
    );
  });

  it("generates and verifies an immutable investigation registration candidate", async () => {
    const fixture = createRepositories();
    await exportFixture(fixture, { write: true });
    write(join(fixture.actionRepo, "dist/index.js"), "fresh bundle\n");
    write(
      join(fixture.actionRepo, "dist/context-gateway.js"),
      "fresh context gateway\n",
    );
    writeContextGatewayReleaseMetadata(fixture.actionRepo, true);
    git(fixture.actionRepo, [
      "add",
      PUBLIC_GENERATED_DIRECTORY,
      "dist/index.js",
      "dist/context-gateway.js",
      PUBLIC_CONTEXT_GATEWAY_RELEASE_METADATA,
    ]);
    git(fixture.actionRepo, [
      "commit",
      "-m",
      "feat: add investigation release",
    ]);
    const actionCommit = head(fixture.actionRepo);
    const releasePath = join(fixture.root, "investigation-release.json");

    const release = generateReleaseManifest({
      actionRepo: fixture.actionRepo,
      targetBranch,
      expectedHead: actionCommit,
      runtimeEntrypointPath: "dist/index.js",
      contextGatewayEntrypointPath: "dist/context-gateway.js",
      output: releasePath,
    });
    expect(release.manifest).toMatchObject({
      releaseManifestVersion: 3,
      contextGatewayPolicyVersion: "context-gateway-v4",
      supportedContextGatewayPolicyVersions: [
        "context-gateway-v3",
        "context-gateway-v4",
      ],
      reviewInvestigationCapability: REVIEW_INVESTIGATION_RELEASE_CAPABILITY,
      reviewInvestigationCoverageProfileHash:
        REVIEW_INVESTIGATION_RELEASE_COVERAGE_PROFILE_HASH,
      reviewInvestigationPolicyHash: REVIEW_INVESTIGATION_RELEASE_POLICY_HASH,
    });
    expect(
      checkReleaseManifest({
        manifest: releasePath,
        saasRepo: fixture.saasRepo,
        actionRepo: fixture.actionRepo,
        sourceDirectory,
      }),
    ).toMatchObject({
      actionCommitSha: actionCommit,
      reviewInvestigationProfile: {
        capability: REVIEW_INVESTIGATION_RELEASE_CAPABILITY,
        coverageProfileHash: REVIEW_INVESTIGATION_RELEASE_COVERAGE_PROFILE_HASH,
        policyHash: REVIEW_INVESTIGATION_RELEASE_POLICY_HASH,
      },
    });
  });

  it("refuses main and stale or abbreviated commit fences", async () => {
    const fixture = createRepositories();
    expect(() =>
      parseExportArgs([
        "--action-repo",
        fixture.actionRepo,
        "--target-branch",
        "main",
        "--expected-head",
        fixture.actionBase,
      ]),
    ).toThrow("non-main local feature branch");
    expect(() =>
      parseExportArgs([
        "--action-repo",
        fixture.actionRepo,
        "--target-branch",
        targetBranch,
        "--expected-head",
        fixture.actionBase.slice(0, 12),
      ]),
    ).toThrow("40-character");
    expect(() =>
      parseReleaseArgs([
        "--action-repo",
        fixture.actionRepo,
        "--target-branch",
        targetBranch,
        "--expected-head",
        fixture.actionBase,
        "--context-gateway-policy-version",
        "operator-supplied-wrong-v9",
      ]),
    ).toThrow("unknown option: --context-gateway-policy-version");
    await expect(
      exportFixture(fixture, { expectedHead: "f".repeat(40) }),
    ).rejects.toThrow("does not match --expected-head");
  });

  it("refuses unmanaged target files instead of overwriting handwritten code", async () => {
    const fixture = createRepositories();
    write(
      join(
        fixture.actionRepo,
        ...PUBLIC_GENERATED_DIRECTORY.split("/"),
        "manual.ts",
      ),
      "export const handwritten = true;\n",
    );
    git(fixture.actionRepo, ["add", PUBLIC_GENERATED_DIRECTORY]);
    git(fixture.actionRepo, ["commit", "-m", "test: add handwritten file"]);
    fixture.actionBase = head(fixture.actionRepo);

    await expect(exportFixture(fixture, { write: true })).rejects.toThrow(
      "without a handoff manifest",
    );
  });

  it("refuses dirty or malformed canonical source output", async () => {
    const dirty = createRepositories();
    write(
      join(dirty.saasRepo, sourceDirectory, "schema.json"),
      '{"dirty":true}\n',
    );
    await expect(exportFixture(dirty)).rejects.toThrow(
      "canonical contract output has uncommitted changes",
    );

    const mismatched = createRepositories();
    const manifestPath = join(
      mismatched.saasRepo,
      sourceDirectory,
      "manifest.json",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.schemaDigest = "0".repeat(63);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    git(mismatched.saasRepo, ["add", sourceDirectory]);
    git(mismatched.saasRepo, ["commit", "-m", "test: stale descriptor"]);
    mismatched.saasHead = head(mismatched.saasRepo);
    await expect(exportFixture(mismatched)).rejects.toThrow(
      "64-character SHA-256 digest",
    );
  });

  it("refuses a release manifest while the rebuilt bundle is uncommitted", async () => {
    const fixture = createRepositories();
    await exportFixture(fixture, { write: true });
    write(join(fixture.actionRepo, "dist/index.js"), "uncommitted bundle\n");
    expect(() =>
      generateReleaseManifest({
        actionRepo: fixture.actionRepo,
        targetBranch,
        expectedHead: fixture.actionBase,
        runtimeEntrypointPath: "dist/index.js",
        contextGatewayEntrypointPath: "dist/context-gateway.js",
        output: "",
      }),
    ).toThrow("repository must be clean");
  });

  it("refuses a symlinked runtime entrypoint", async () => {
    const fixture = createRepositories();
    await exportFixture(fixture, { write: true });
    write(
      join(fixture.actionRepo, "dist/context-gateway.js"),
      "fresh context gateway\n",
    );
    writeContextGatewayReleaseMetadata(fixture.actionRepo);
    rmSync(join(fixture.actionRepo, "dist/index.js"));
    symlinkSync(
      "context-gateway.js",
      join(fixture.actionRepo, "dist/index.js"),
    );
    git(fixture.actionRepo, ["add", "dist", PUBLIC_GENERATED_DIRECTORY]);
    git(fixture.actionRepo, ["commit", "-m", "test: add symlinked runtime"]);
    const actionCommit = head(fixture.actionRepo);

    expect(() =>
      generateReleaseManifest({
        actionRepo: fixture.actionRepo,
        targetBranch,
        expectedHead: actionCommit,
        runtimeEntrypointPath: "dist/index.js",
        contextGatewayEntrypointPath: "dist/context-gateway.js",
        output: "",
      }),
    ).toThrow(
      "committed release artifact must be a regular file: dist/index.js",
    );
  });
});

type Repositories = {
  root: string;
  saasRepo: string;
  actionRepo: string;
  saasHead: string;
  actionBase: string;
};

function createRepositories(): Repositories {
  const root = mkdtempSync(join(tmpdir(), "review-action-v2-release-"));
  temporaryDirectories.push(root);
  const saasRepo = join(root, "saas");
  const actionRepo = join(root, "action");
  initializeRepository(saasRepo, "main");
  cpSync(
    join(fixtureRoot, "contract-source"),
    join(saasRepo, sourceDirectory),
    {
      recursive: true,
    },
  );
  git(saasRepo, ["add", sourceDirectory]);
  git(saasRepo, ["commit", "-m", "test: add canonical contract"]);

  initializeRepository(actionRepo, targetBranch);
  write(join(actionRepo, "dist/index.js"), "old bundle\n");
  write(
    join(actionRepo, "src/control-plane/review-agent-profiles.json"),
    JSON.stringify([
      {
        profileRef: "fixture-codex",
        agentKind: "codex",
        binarySha256: "a".repeat(64),
        packageVersion: "0.147.0",
        modelTransports: ["account_gateway"],
        contextGateway: true,
        cancellation: true,
      },
    ]),
  );
  git(actionRepo, ["add", "src/control-plane/review-agent-profiles.json"]);
  git(actionRepo, ["add", "dist/index.js"]);
  git(actionRepo, ["commit", "-m", "test: add existing bundle"]);
  return {
    root,
    saasRepo,
    actionRepo,
    saasHead: head(saasRepo),
    actionBase: head(actionRepo),
  };
}

function writeContextGatewayReleaseMetadata(
  actionRepo: string,
  investigation = false,
): void {
  const entrypointPath = "dist/context-gateway.js";
  write(
    join(actionRepo, PUBLIC_CONTEXT_GATEWAY_RELEASE_METADATA),
    canonicalJson({
      artifactKind: "reviewrouter-context-gateway",
      contextGatewayEntrypointDigest: sha256Digest(
        readFileSync(join(actionRepo, entrypointPath)),
      ),
      contextGatewayEntrypointPath: entrypointPath,
      contextGatewayPolicyVersion: investigation
        ? "context-gateway-v4"
        : "context-gateway-v3",
      metadataVersion: investigation ? 2 : 1,
      ...(investigation
        ? {
            reviewInvestigationCapability:
              REVIEW_INVESTIGATION_RELEASE_CAPABILITY,
            reviewInvestigationCoverageProfileHash:
              REVIEW_INVESTIGATION_RELEASE_COVERAGE_PROFILE_HASH,
            reviewInvestigationPolicyHash:
              REVIEW_INVESTIGATION_RELEASE_POLICY_HASH,
            supportedContextGatewayPolicyVersions: [
              "context-gateway-v3",
              "context-gateway-v4",
            ],
          }
        : {}),
    }),
  );
}

function initializeRepository(repository: string, branch: string): void {
  mkdirSync(repository, { recursive: true });
  git(repository, ["init", "-b", branch]);
  git(repository, ["config", "user.name", "iliya"]);
  git(repository, ["config", "user.email", "iliyazelenkog@gmail.com"]);
  write(join(repository, "README.md"), "fixture\n");
  git(repository, ["add", "README.md"]);
  git(repository, ["commit", "-m", "test: initialize"]);
}

async function exportFixture(
  fixture: Repositories,
  overrides: { write?: boolean; expectedHead?: string } = {},
) {
  return await exportPublicContract({
    saasRepo: fixture.saasRepo,
    actionRepo: fixture.actionRepo,
    sourceDirectory,
    targetBranch,
    expectedHead: overrides.expectedHead ?? fixture.actionBase,
    expectedSaasHead: fixture.saasHead,
    write: overrides.write ?? false,
  });
}

function write(file: string, contents: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function head(repository: string): string {
  return git(repository, ["rev-parse", "HEAD"]);
}

function git(repository: string, args: string[]): string {
  if (args[0] === "commit") {
    for (const variable of ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"]) {
      const identity = execFileSync("git", ["var", variable], {
        cwd: repository,
        encoding: "utf8",
      });
      if (!identity.startsWith("iliya <iliyazelenkog@gmail.com> "))
        throw new Error(`fixture commit identity invalid: ${variable}`);
    }
  }
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
