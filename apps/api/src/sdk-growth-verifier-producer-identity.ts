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

function execution(value: unknown): AuthenticatedEfExecution {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject();
  const record = value as Record<string, unknown>;
  if (
    Reflect.ownKeys(record).length !== executionKeys.length ||
    !executionKeys.every((key) => Object.hasOwn(record, key))
  )
    reject();
  const bounded = (key: string) =>
    typeof record[key] === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/.test(record[key]);
  if (
    !Number.isSafeInteger(record.pullRequest) ||
    (record.pullRequest as number) < 1 ||
    !executionKeys.filter((key) => key !== "pullRequest").every(bounded) ||
    !["verifierRevision", "sourceCommit", "sourceTree"].every((key) =>
      /^[a-f0-9]{40}$/.test(record[key] as string),
    )
  )
    reject();
  return Object.fromEntries(
    executionKeys.map((key) => [key, record[key]]),
  ) as unknown as AuthenticatedEfExecution;
}

function executionDigest(value: AuthenticatedEfExecution): string {
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
    !(row.revokedAt === null || row.revokedAt instanceof Date)
  )
    reject();
  const identity = execution(row.execution);
  if (row.jobKey !== jobKey(identity)) reject();
  return {
    assignmentId: row.assignmentId,
    jobKey: row.jobKey,
    execution: identity,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}

/** Protected scheduler storage; never expose create/revoke through candidate routes. */
export class PrismaSdkGrowthVerifierAssignmentStore {
  constructor(private readonly prisma: StorePrisma) {}

  async create(
    value: AuthenticatedEfExecution,
    expiresAt: Date,
  ): Promise<ProtectedVerifierAssignment> {
    const identity = execution(value);
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
        await transaction.$executeRaw`
          UPDATE "SdkGrowthVerifierAssignment" SET "revokedAt" = now()
          WHERE "jobKey" = ${scope} AND "revokedAt" IS NULL`;
        const rows = await transaction.$queryRaw`
          INSERT INTO "SdkGrowthVerifierAssignment" (
            "assignmentId", "jobKey", "execution", "createdAt", "expiresAt"
          ) VALUES (${assignmentId}, ${scope}, ${JSON.stringify(identity)}::jsonb, ${now}, ${expiresAt})
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
    const rows = await (transaction ?? this.prisma).$queryRaw`
      SELECT * FROM "SdkGrowthVerifierAssignment"
      WHERE "assignmentId" = ${assignmentId} FOR SHARE`;
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
      executionDigest: executionDigest(row.execution),
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
        typeof payload.executionDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(payload.executionDigest) ||
        typeof payload.iat !== "number" ||
        typeof payload.exp !== "number" ||
        payload.exp - payload.iat > maxCredentialSeconds ||
        payload.iat > Math.floor(current.getTime() / 1000) ||
        !/^[0-9a-f-]{36}$/.test(payload.assignmentId)
      )
        reject();
      const row = await this.store.load(payload.assignmentId, transaction);
      if (
        !row ||
        row.revokedAt ||
        current.getTime() >= row.expiresAt.getTime() ||
        current.getTime() < row.createdAt.getTime() ||
        payload.iat < Math.floor(row.createdAt.getTime() / 1000) ||
        payload.exp * 1000 > row.expiresAt.getTime() ||
        payload.executionDigest !== executionDigest(row.execution)
      )
        reject();
      return {
        producer: subject,
        issuer,
        subject,
        authenticationId: payload.jti,
        execution: row.execution,
      };
    } catch {
      return reject();
    }
  }
}
