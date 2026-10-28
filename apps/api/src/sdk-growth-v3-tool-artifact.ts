import { createHash } from "node:crypto";

const packageName = "@agent-teams/engineering-foundation" as const;
const maximumArchiveBytes = 16 * 1024 * 1024;
const commitPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;

type Query = {
  $queryRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]>;
};
type Writer = Query & {
  $executeRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
};

export interface EfToolArtifactInput {
  readonly archive: Uint8Array;
  readonly packageVersion: string;
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly installedDistributionDigest: string;
}

export interface RetainedEfToolArtifact {
  readonly artifactId: string;
  readonly packageName: typeof packageName;
  readonly packageVersion: string;
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly installedDistributionDigest: string;
  readonly provenanceKind: "source-built-fixture";
  readonly archive: Uint8Array;
  readonly archiveByteLength: number;
  readonly archiveSha256: string;
  readonly archiveSha512Sri: string;
}

function reject(): never {
  throw new Error("sdk_growth_v3_tool_artifact_invalid");
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sha512Sri(bytes: Uint8Array): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

function identity(
  value: Omit<RetainedEfToolArtifact, "artifactId" | "archive">,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "sdk-growth-v3-tool-artifact:v1",
        value.packageName,
        value.packageVersion,
        value.sourceCommit,
        value.sourceTree,
        value.installedDistributionDigest,
        value.provenanceKind,
        value.archiveByteLength,
        value.archiveSha256,
        value.archiveSha512Sri,
      ]),
    )
    .digest("hex");
}

function input(value: EfToolArtifactInput): RetainedEfToolArtifact {
  if (
    !(value.archive instanceof Uint8Array) ||
    value.archive.byteLength === 0 ||
    value.archive.byteLength > maximumArchiveBytes ||
    !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value.packageVersion) ||
    !commitPattern.test(value.sourceCommit) ||
    !commitPattern.test(value.sourceTree) ||
    !digestPattern.test(value.installedDistributionDigest)
  )
    reject();
  const archive = Uint8Array.from(value.archive);
  const fields = {
    packageName,
    packageVersion: value.packageVersion,
    sourceCommit: value.sourceCommit,
    sourceTree: value.sourceTree,
    installedDistributionDigest: value.installedDistributionDigest,
    provenanceKind: "source-built-fixture" as const,
    archiveByteLength: archive.byteLength,
    archiveSha256: sha256(archive),
    archiveSha512Sri: sha512Sri(archive),
  };
  return { artifactId: identity(fields), ...fields, archive };
}

function retained(value: unknown): RetainedEfToolArtifact {
  if (!value || typeof value !== "object") reject();
  const row = value as Record<string, unknown>;
  if (
    typeof row.artifactId !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.artifactId) ||
    row.packageName !== packageName ||
    row.provenanceKind !== "source-built-fixture" ||
    typeof row.packageVersion !== "string" ||
    typeof row.sourceCommit !== "string" ||
    typeof row.sourceTree !== "string" ||
    typeof row.installedDistributionDigest !== "string" ||
    !(row.archive instanceof Uint8Array) ||
    !Number.isSafeInteger(row.archiveByteLength) ||
    row.archiveByteLength !== row.archive.byteLength ||
    row.archiveByteLength === 0 ||
    row.archiveByteLength > maximumArchiveBytes ||
    row.archiveSha256 !== sha256(row.archive) ||
    row.archiveSha512Sri !== sha512Sri(row.archive)
  )
    reject();
  const verified = input({
    archive: row.archive,
    packageVersion: row.packageVersion,
    sourceCommit: row.sourceCommit,
    sourceTree: row.sourceTree,
    installedDistributionDigest: row.installedDistributionDigest,
  });
  if (verified.artifactId !== row.artifactId) reject();
  return verified;
}

/** Protected scheduler-only fixture custody. No production route composes it. */
export class PrismaSdkGrowthV3ToolArtifactStore {
  constructor(private readonly prisma: Writer) {}

  async retain(value: EfToolArtifactInput): Promise<RetainedEfToolArtifact> {
    const artifact = input(value);
    await this.prisma.$executeRaw`
      INSERT INTO "SdkGrowthV3ToolArtifact" (
        "artifactId", "packageName", "packageVersion", "sourceCommit",
        "sourceTree", "installedDistributionDigest", "provenanceKind",
        "archive", "archiveByteLength", "archiveSha256", "archiveSha512Sri"
      ) VALUES (
        ${artifact.artifactId}, ${artifact.packageName}, ${artifact.packageVersion},
        ${artifact.sourceCommit}, ${artifact.sourceTree},
        ${artifact.installedDistributionDigest}, ${artifact.provenanceKind},
        ${artifact.archive}, ${artifact.archiveByteLength},
        ${artifact.archiveSha256}, ${artifact.archiveSha512Sri}
      ) ON CONFLICT ("artifactId") DO NOTHING`;
    const stored = await this.load(artifact.artifactId);
    if (!stored) reject();
    return stored;
  }

  async load(
    artifactId: string,
    transaction: Query = this.prisma,
  ): Promise<RetainedEfToolArtifact | null> {
    if (!/^[a-f0-9]{64}$/.test(artifactId)) reject();
    const rows = await transaction.$queryRaw`
      SELECT * FROM "SdkGrowthV3ToolArtifact"
      WHERE "artifactId" = ${artifactId}`;
    if (rows.length === 0) return null;
    if (rows.length !== 1) reject();
    return retained(rows[0]);
  }
}
