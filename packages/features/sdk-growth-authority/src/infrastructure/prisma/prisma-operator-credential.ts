import { createHash, timingSafeEqual } from "node:crypto";
import type {
  AuthenticatedAuthorityPrincipal,
  AuthorityChange,
  AuthorityScope,
} from "../../application/ports.js";
import { AuthorityError } from "../../domain/contracts.js";

const credentialIdPattern = /^[A-Za-z0-9_-]{16,64}$/;
const tokenPattern = /^g1\.([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]{43})$/;
const digestPattern = /^[a-f0-9]{64}$/;
const principalTextPattern = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/;
const changes: readonly AuthorityChange[] = [
  "provision",
  "binding-replacement",
  "owner-replacement",
  "owner-revocation",
  "installation-invalidation",
  "verifier-withdrawal",
];
const dummyDigest = Buffer.alloc(32);

function denied(): never {
  throw new AuthorityError("owner-evidence");
}

function parseCredential(value: unknown): { id: string; token: string } {
  if (typeof value !== "string") denied();
  const match = tokenPattern.exec(value);
  if (
    !match ||
    Buffer.from(match[2]!, "base64url").toString("base64url") !== match[2]
  )
    denied();
  return { id: match[1]!, token: value };
}

/** Use only at a future approved secret-store/stdin provisioning boundary.
 * The caller owns and must discard the raw token; only this digest is durable. */
export function hashG1OperatorCredential(credential: unknown): {
  credentialId: string;
  verifierSha256: string;
} {
  const { id, token } = parseCredential(credential);
  return {
    credentialId: id,
    verifierSha256: createHash("sha256")
      .update("reviewrouter:g1:operator-credential:v1\0")
      .update(token)
      .digest("hex"),
  };
}

export interface G1OperatorCredentialRow {
  readonly credentialId: string;
  readonly generation: bigint;
  readonly verifierSha256: string;
  readonly disabled: boolean;
  readonly expiresAtMs: bigint;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly pullRequest: bigint;
  readonly githubRepositoryId: string;
  readonly installationId: string;
  readonly issuer: string;
  readonly subject: string;
  readonly allowedOperations: readonly string[];
}

export interface G1OperatorCredentialReadPort {
  findCredential(credentialId: string): Promise<G1OperatorCredentialRow | null>;
}

/** P1b must compare this identity to the locked current row inside the same
 * transaction that advances the authority epoch. Authentication alone is not
 * permission for a later write. */
export interface G1OperatorCredentialFence {
  readonly credentialId: string;
  readonly generation: bigint;
}

export interface G1AuthenticatedOperator {
  readonly principal: AuthenticatedAuthorityPrincipal;
  readonly fence: G1OperatorCredentialFence;
}

export class G1OperatorCredentialAuthenticator {
  constructor(
    private readonly credentials: G1OperatorCredentialReadPort,
    private readonly now: () => number = Date.now,
  ) {}

  async authenticateWithFence(
    credential: unknown,
    scope: AuthorityScope,
    change: AuthorityChange,
  ): Promise<G1AuthenticatedOperator> {
    const { credentialId, verifierSha256 } =
      hashG1OperatorCredential(credential);
    const row = await this.credentials.findCredential(credentialId);
    const stored = row?.verifierSha256;
    const candidate = Buffer.from(verifierSha256, "hex");
    const expected =
      stored && digestPattern.test(stored)
        ? Buffer.from(stored, "hex")
        : dummyDigest;
    const matched = timingSafeEqual(candidate, expected);
    const now = this.now();
    if (
      !row ||
      !matched ||
      !digestPattern.test(row.verifierSha256) ||
      row.credentialId !== credentialId ||
      !credentialIdPattern.test(row.credentialId) ||
      row.disabled ||
      row.generation < 1n ||
      typeof row.expiresAtMs !== "bigint" ||
      row.expiresAtMs <= 0n ||
      !Number.isSafeInteger(now) ||
      now < 0 ||
      BigInt(now) >= row.expiresAtMs ||
      !Number.isSafeInteger(scope.pullRequest) ||
      scope.pullRequest < 1 ||
      row.tenantId !== scope.tenantId ||
      row.repositoryId !== scope.repositoryId ||
      row.pullRequest !== BigInt(scope.pullRequest) ||
      !changes.includes(change) ||
      !Array.isArray(row.allowedOperations) ||
      !row.allowedOperations.includes(change) ||
      row.allowedOperations.length === 0 ||
      ![
        row.issuer,
        row.subject,
        row.tenantId,
        row.repositoryId,
        row.githubRepositoryId,
        row.installationId,
      ].every((value) => principalTextPattern.test(value))
    )
      denied();
    return {
      principal: {
        issuer: row.issuer,
        subject: row.subject,
        authenticationId: `g1:${row.credentialId}:${row.generation}`,
        tenantId: row.tenantId,
        repositoryId: row.repositoryId,
        githubRepositoryId: row.githubRepositoryId,
        installationId: row.installationId,
      },
      fence: { credentialId: row.credentialId, generation: row.generation },
    };
  }
}

interface RawReadClient {
  $queryRaw<T = unknown[]>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
}

/** Read-only dormant adapter. No production composition or provisioning path. */
export class PrismaG1OperatorCredentialReader implements G1OperatorCredentialReadPort {
  constructor(private readonly prisma: RawReadClient) {}

  async findCredential(
    credentialId: string,
  ): Promise<G1OperatorCredentialRow | null> {
    const rows = await this.prisma.$queryRaw<G1OperatorCredentialRow[]>`
      SELECT "credentialId", "generation", "verifierSha256", "disabled", "expiresAtMs",
             "tenantId", "repositoryId", "pullRequest", "githubRepositoryId",
             "installationId", "issuer", "subject", "allowedOperations"
      FROM "SdkGrowthOperatorCredential"
      WHERE "credentialId" = ${credentialId}`;
    return rows[0] ?? null;
  }
}
