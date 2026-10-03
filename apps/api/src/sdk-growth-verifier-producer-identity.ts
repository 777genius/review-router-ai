import { createHash, randomUUID, KeyObject } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import type { AuthenticatedEfExecution } from "@reviewrouter/features-sdk-growth-authority";
import type {
  AuthenticatedSdkGrowthVerifierProducer,
  SdkGrowthVerifierProducerAuthenticatorPort,
} from "./sdk-growth-verifier-custody.js";

const issuer = "reviewrouter-sdk-verifier-workload";
const audience = "reviewrouter-sdk-verifier-custody";
const subject = "reviewrouter-verifier";
const tokenType = "rr-sdk-verifier+jwt";
const executionKeys = [
  "tenantId",
  "repositoryId",
  "pullRequest",
  "githubRepositoryId",
  "installationId",
  "subject",
  "runId",
  "runAttempt",
  "verifierRevision",
  "sourceCommit",
  "sourceTree",
] as const;
const sourceBindingKeys = [
  "headRepositoryId",
  "baseRepositoryId",
  "baseRef",
  "baseCommit",
  "baseTree",
  "mergeBaseCommit",
  "mergeBaseTree",
] as const;
const maxCredentialSeconds = 300;
const maxAssignmentMs = 24 * 60 * 60 * 1000;

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
type StorePrisma = Writer & {
  $transaction<T>(
    operation: (transaction: Writer) => Promise<T>,
    options: { isolationLevel: "ReadCommitted" },
  ): Promise<T>;
};

function reject(): never {
  throw new Error("sdk_growth_verifier_credential_rejected");
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function sourceBinding(
  value: unknown,
  repositoryId: string,
): NonNullable<AuthenticatedEfExecution["sourceBinding"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject();
  const binding = value as Record<string, unknown>;
  if (!exactKeys(binding, sourceBindingKeys)) reject();
  const numericId = (key: "headRepositoryId" | "baseRepositoryId") => {
    const id = binding[key];
    if (
      typeof id !== "string" ||
      !/^[1-9][0-9]*$/.test(id) ||
      !Number.isSafeInteger(Number(id))
    )
      reject();
    return id;
  };
  const commit = (
    key: "baseCommit" | "baseTree" | "mergeBaseCommit" | "mergeBaseTree",
  ) => {
    const value = binding[key];
    if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) reject();
    return value;
  };
  const baseRef = binding.baseRef;
  if (
    typeof baseRef !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(baseRef) ||
    baseRef.includes("..") ||
    baseRef.includes("//") ||
    baseRef.endsWith("/") ||
    baseRef.endsWith(".lock")
  )
    reject();
  const result = {
    headRepositoryId: numericId("headRepositoryId"),
    baseRepositoryId: numericId("baseRepositoryId"),
    baseRef,
    baseCommit: commit("baseCommit"),
    baseTree: commit("baseTree"),
    mergeBaseCommit: commit("mergeBaseCommit"),
    mergeBaseTree: commit("mergeBaseTree"),
  };
  if (
    result.headRepositoryId !== repositoryId ||
    result.baseRepositoryId !== repositoryId
  )
    reject();
  return result;
}

function execution(
  value: unknown,
  persisted = false,
): AuthenticatedEfExecution {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject();
  const record = value as Record<string, unknown>;
  const version = persisted
    ? Object.hasOwn(record, "version")
      ? record.version
      : 1
    : Object.hasOwn(record, "sourceBinding")
      ? 2
      : 1;
  const expectedKeys =
    version === 2
      ? persisted
        ? [...executionKeys, "sourceBinding", "version"]
        : [...executionKeys, "sourceBinding"]
      : executionKeys;
  if (
    (version !== 1 && version !== 2) ||
    (version === 2) !== Object.hasOwn(record, "sourceBinding") ||
    !exactKeys(record, expectedKeys)
  )
    reject();
  const stringField = (key: string): string => {
    const field = record[key];
    if (
      typeof field !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/.test(field)
    )
      reject();
    return field;
  };
  const pullRequest = record.pullRequest;
  if (
    typeof pullRequest !== "number" ||
    !Number.isSafeInteger(pullRequest) ||
    pullRequest < 1
  )
    reject();
  const identity = {
    tenantId: stringField("tenantId"),
    repositoryId: stringField("repositoryId"),
    pullRequest,
    githubRepositoryId: stringField("githubRepositoryId"),
    installationId: stringField("installationId"),
    subject: stringField("subject"),
    runId: stringField("runId"),
    runAttempt: stringField("runAttempt"),
    verifierRevision: stringField("verifierRevision"),
    sourceCommit: stringField("sourceCommit"),
    sourceTree: stringField("sourceTree"),
  };
  if (
    ![
      identity.verifierRevision,
      identity.sourceCommit,
      identity.sourceTree,
    ].every((value) => /^[a-f0-9]{40}$/.test(value))
  )
    reject();
  if (!Object.hasOwn(record, "sourceBinding")) return identity;
  return {
    ...identity,
    sourceBinding: sourceBinding(
      record.sourceBinding,
      identity.githubRepositoryId,
    ),
  };
}

function executionDigest(value: AuthenticatedEfExecution): string {
  if (value.sourceBinding) {
    return createHash("sha256")
      .update(
        JSON.stringify([
          "reviewrouter-sdk-verifier-execution:v2",
          ...executionKeys.map((key) => value[key]),
          ...sourceBindingKeys.map((key) => value.sourceBinding![key]),
        ]),
      )
      .digest("hex");
  }
  return createHash("sha256")
    .update(JSON.stringify(executionKeys.map((key) => value[key])))
    .digest("hex");
}

function jobKey(value: AuthenticatedEfExecution): string {
  return createHash("sha256")
    .update(
      JSON.stringify([value.tenantId, value.repositoryId, value.pullRequest]),
    )
    .digest("hex");
}

function assertVerifierKey(
  key: KeyObject,
  type: "private" | "public",
): KeyObject {
  if (
    !(key instanceof KeyObject) ||
    key.type !== type ||
    key.asymmetricKeyType !== "ed25519"
  ) {
    throw new Error("sdk_growth_verifier_key_invalid");
  }
  return key;
}

export interface ProtectedVerifierAssignment {
  readonly assignmentId: string;
  readonly jobKey: string;
  readonly execution: AuthenticatedEfExecution;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly efToolArtifactId?: string;
}

function assignment(value: unknown): ProtectedVerifierAssignment {
  if (!value || typeof value !== "object") reject();
  const row = value as Record<string, unknown>;
  if (
    typeof row.assignmentId !== "string" ||
    !/^[0-9a-f-]{36}$/.test(row.assignmentId) ||
    typeof row.jobKey !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.jobKey) ||
    !(row.createdAt instanceof Date) ||
    !(row.expiresAt instanceof Date) ||
    !(row.revokedAt === null || row.revokedAt instanceof Date) ||
    !(
      row.efToolArtifactId === null ||
      row.efToolArtifactId === undefined ||
      (typeof row.efToolArtifactId === "string" &&
        /^[a-f0-9]{64}$/.test(row.efToolArtifactId))
    )
  )
    reject();
  const identity = execution(row.execution, true);
  if (row.jobKey !== jobKey(identity)) reject();
  return {
    assignmentId: row.assignmentId,
    jobKey: row.jobKey,
    execution: identity,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    ...(typeof row.efToolArtifactId === "string"
      ? { efToolArtifactId: row.efToolArtifactId }
      : {}),
  };
}

function pinnedAssignmentDigest(
  execution: AuthenticatedEfExecution,
  artifactId: string,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "reviewrouter-sdk-verifier-assignment:v3",
        executionDigest(execution),
        artifactId,
      ]),
    )
    .digest("hex");
}

/** Protected scheduler storage; never expose create/revoke through candidate routes. */
export class PrismaSdkGrowthVerifierAssignmentStore {
  constructor(private readonly prisma: StorePrisma) {}

  async create(
    value: AuthenticatedEfExecution,
    expiresAt: Date,
  ): Promise<ProtectedVerifierAssignment> {
    return this.createInternal(value, expiresAt);
  }

  /** A separate scheduler-only path; legacy assignments keep their token shape. */
  async createPinned(
    value: AuthenticatedEfExecution,
    expiresAt: Date,
    efToolArtifactId: string,
  ): Promise<ProtectedVerifierAssignment> {
    if (!/^[a-f0-9]{64}$/.test(efToolArtifactId)) reject();
    return this.createInternal(value, expiresAt, efToolArtifactId);
  }

  private async createInternal(
    value: AuthenticatedEfExecution,
    expiresAt: Date,
    efToolArtifactId?: string,
  ): Promise<ProtectedVerifierAssignment> {
    const identity = execution(value);
    const persisted = identity.sourceBinding
      ? { ...identity, version: 2 }
      : identity;
    const now = new Date();
    if (
      !(expiresAt instanceof Date) ||
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt.getTime() <= now.getTime() ||
      expiresAt.getTime() > now.getTime() + maxAssignmentMs
    )
      reject();
    const assignmentId = randomUUID();
    const scope = jobKey(identity);
    return this.prisma.$transaction(
      async (transaction) => {
        // The scope may have no row yet. Lock its stable key before either write.
        await transaction.$queryRaw`
          SELECT 1 AS "locked"
          FROM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${scope}, 0))`;
        const lockedAt = new Date();
        if (
          expiresAt.getTime() <= lockedAt.getTime() ||
          expiresAt.getTime() > lockedAt.getTime() + maxAssignmentMs
        )
          reject();
        await transaction.$executeRaw`
          UPDATE "SdkGrowthVerifierAssignment" SET "revokedAt" = now()
          WHERE "jobKey" = ${scope} AND "revokedAt" IS NULL`;
        const rows = efToolArtifactId
          ? await transaction.$queryRaw`
              INSERT INTO "SdkGrowthVerifierAssignment" (
                "assignmentId", "jobKey", "execution", "createdAt", "expiresAt", "efToolArtifactId"
              ) VALUES (${assignmentId}, ${scope}, ${JSON.stringify(persisted)}::jsonb, ${lockedAt}, ${expiresAt}, ${efToolArtifactId})
              RETURNING *`
          : await transaction.$queryRaw`
              INSERT INTO "SdkGrowthVerifierAssignment" (
                "assignmentId", "jobKey", "execution", "createdAt", "expiresAt"
              ) VALUES (${assignmentId}, ${scope}, ${JSON.stringify(persisted)}::jsonb, ${lockedAt}, ${expiresAt})
              RETURNING *`;
        if (rows.length !== 1) reject();
        return assignment(rows[0]);
      },
      { isolationLevel: "ReadCommitted" },
    );
  }

  async revoke(assignmentId: string): Promise<boolean> {
    if (!/^[0-9a-f-]{36}$/.test(assignmentId)) reject();
    return (
      (await this.prisma.$executeRaw`
      UPDATE "SdkGrowthVerifierAssignment" SET "revokedAt" = now()
      WHERE "assignmentId" = ${assignmentId} AND "revokedAt" IS NULL`) === 1
    );
  }

  async load(
    assignmentId: string,
    transaction?: Query,
  ): Promise<ProtectedVerifierAssignment | null> {
    if (!/^[0-9a-f-]{36}$/.test(assignmentId)) reject();
    const rows = transaction
      ? await transaction.$queryRaw`
          SELECT * FROM public.sdk_growth_verifier_assignment_lock(${assignmentId})`
      : await this.prisma.$queryRaw`
          SELECT * FROM "SdkGrowthVerifierAssignment"
          WHERE "assignmentId" = ${assignmentId}`;
    if (rows.length !== 1) return null;
    return assignment(rows[0]);
  }
}

/** Internal issuer used only after the protected scheduler persists a job. */
export class SdkGrowthVerifierCredentialIssuer {
  private readonly key: KeyObject;
  constructor(
    private readonly store: PrismaSdkGrowthVerifierAssignmentStore,
    privateKey: KeyObject,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.key = assertVerifierKey(privateKey, "private");
  }

  async issue(assignmentId: string): Promise<string> {
    const row = await this.store.load(assignmentId);
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    const expiration = Math.min(
      nowSeconds + maxCredentialSeconds,
      Math.floor((row?.expiresAt.getTime() ?? 0) / 1000),
    );
    if (
      !row ||
      row.revokedAt ||
      expiration <= nowSeconds ||
      row.createdAt.getTime() > this.now().getTime()
    )
      reject();
    return new SignJWT({
      assignmentId: row.assignmentId,
      ...(row.efToolArtifactId
        ? {
            assignmentDigest: pinnedAssignmentDigest(
              row.execution,
              row.efToolArtifactId,
            ),
          }
        : { executionDigest: executionDigest(row.execution) }),
    })
      .setProtectedHeader({ alg: "EdDSA", typ: tokenType })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject)
      .setJti(randomUUID())
      .setIssuedAt(nowSeconds)
      .setNotBefore(nowSeconds)
      .setExpirationTime(expiration)
      .sign(this.key);
  }
}

/** Same token can retry idempotent custody writes until it expires. Revocation
 * and expiry are checked against the locked assignment on every write. */
export class JoseSdkGrowthVerifierProducerAuthenticator implements SdkGrowthVerifierProducerAuthenticatorPort {
  private readonly key: KeyObject;
  constructor(
    private readonly store: PrismaSdkGrowthVerifierAssignmentStore,
    publicKey: KeyObject,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.key = assertVerifierKey(publicKey, "public");
  }

  async authenticate(
    credential: unknown,
    transaction?: Query,
  ): Promise<AuthenticatedSdkGrowthVerifierProducer> {
    if (
      typeof credential !== "string" ||
      credential.length > 4096 ||
      credential.split(".").length !== 3
    )
      reject();
    try {
      const current = this.now();
      const { payload, protectedHeader } = await jwtVerify(
        credential,
        this.key,
        {
          issuer,
          audience,
          algorithms: ["EdDSA"],
          currentDate: current,
          typ: tokenType,
        },
      );
      if (
        protectedHeader.alg !== "EdDSA" ||
        protectedHeader.typ !== tokenType ||
        payload.sub !== subject ||
        typeof payload.jti !== "string" ||
        !/^[0-9a-f-]{36}$/.test(payload.jti) ||
        typeof payload.assignmentId !== "string" ||
        !(
          (typeof payload.executionDigest === "string" &&
            /^[a-f0-9]{64}$/.test(payload.executionDigest) &&
            payload.assignmentDigest === undefined) ||
          (typeof payload.assignmentDigest === "string" &&
            /^[a-f0-9]{64}$/.test(payload.assignmentDigest) &&
            payload.executionDigest === undefined)
        ) ||
        typeof payload.iat !== "number" ||
        typeof payload.exp !== "number" ||
        payload.exp - payload.iat > maxCredentialSeconds ||
        payload.iat > Math.floor(current.getTime() / 1000) ||
        !/^[0-9a-f-]{36}$/.test(payload.assignmentId)
      )
        reject();
      const row = await this.store.load(payload.assignmentId, transaction);
      // The row lock may have waited behind a scheduler revocation. Validate
      // both deadlines against time observed after acquiring that lock.
      const lockedAt = this.now();
      if (
        !row ||
        row.revokedAt ||
        lockedAt.getTime() >= payload.exp * 1000 ||
        lockedAt.getTime() >= row.expiresAt.getTime() ||
        lockedAt.getTime() < row.createdAt.getTime() ||
        payload.iat < Math.floor(row.createdAt.getTime() / 1000) ||
        payload.exp * 1000 > row.expiresAt.getTime() ||
        (row.efToolArtifactId
          ? payload.assignmentDigest !==
            pinnedAssignmentDigest(row.execution, row.efToolArtifactId)
          : payload.executionDigest !== executionDigest(row.execution))
      )
        reject();
      return {
        producer: subject,
        issuer,
        subject,
        authenticationId: payload.jti,
        execution: row.execution,
        ...(row.efToolArtifactId
          ? { efToolArtifactId: row.efToolArtifactId }
          : {}),
      };
    } catch {
      return reject();
    }
  }
}
