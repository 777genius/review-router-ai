import { generateKeyPairSync } from "node:crypto";
import { decodeJwt, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import type { AuthenticatedEfExecution } from "@reviewrouter/features-sdk-growth-authority";
import { SdkGrowthVerifierAuthorityPolicy } from "@reviewrouter/features-sdk-growth-authority";
import { PrismaSdkGrowthVerifierEvidenceCustody } from "./sdk-growth-verifier-custody.js";
import {
  JoseSdkGrowthVerifierProducerAuthenticator,
  PrismaSdkGrowthVerifierAssignmentStore,
  SdkGrowthVerifierCredentialIssuer,
} from "./sdk-growth-verifier-producer-identity.js";

const execution: AuthenticatedEfExecution = {
  tenantId: "disposable-tenant",
  repositoryId: "disposable-repo",
  pullRequest: 17,
  githubRepositoryId: "100",
  installationId: "200",
  subject: "runner",
  runId: "300",
  runAttempt: "1",
  verifierRevision: "1".repeat(40),
  sourceCommit: "2".repeat(40),
  sourceTree: "3".repeat(40),
};

type AssignmentRow = {
  assignmentId: string;
  jobKey?: string;
  execution: AuthenticatedEfExecution;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};
type FakeTransaction = {
  $queryRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]>;
  $executeRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
};

function fixture() {
  const rows = new Map<string, AssignmentRow>();
  const writes: string[] = [];
  const db = {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join("?");
      if (sql.includes('INSERT INTO "SdkGrowthVerifierAssignment"')) {
        const row: AssignmentRow = {
          assignmentId: values[0] as string,
          jobKey: values[1] as string,
          execution: JSON.parse(values[2] as string),
          createdAt: values[3] as Date,
          expiresAt: values[4] as Date,
          revokedAt: null,
        };
        rows.set(row.assignmentId, row);
        return [structuredClone(row)];
      }
      if (sql.includes('FROM "SdkGrowthVerifierAssignment"')) {
        const row = rows.get(values[0] as string);
        return row ? [structuredClone(row)] : [];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
    async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join("?");
      if (sql.includes('UPDATE "SdkGrowthVerifierAssignment"')) {
        if (sql.includes('"jobKey"')) {
          let count = 0;
          for (const row of rows.values()) {
            if (row.jobKey === values[0] && !row.revokedAt) {
              row.revokedAt = new Date();
              count++;
            }
          }
          return count;
        }
        const row = rows.get(values[0] as string);
        if (!row || row.revokedAt) return 0;
        row.revokedAt = new Date();
        return 1;
      }
      writes.push(sql);
      throw new Error(`unexpected write: ${sql}`);
    },
    async $transaction<T>(operation: (tx: FakeTransaction) => Promise<T>) {
      return operation(db);
    },
  };
  const keys = generateKeyPairSync("ed25519");
  const store = new PrismaSdkGrowthVerifierAssignmentStore(db);
  let current: Date | null = null;
  const now = () => current ?? new Date();
  const issuer = new SdkGrowthVerifierCredentialIssuer(
    store,
    keys.privateKey,
    now,
  );
  const authenticator = new JoseSdkGrowthVerifierProducerAuthenticator(
    store,
    keys.publicKey,
    now,
  );
  return {
    db,
    rows,
    writes,
    store,
    issuer,
    authenticator,
    keys,
    setNow(value: Date) {
      current = value;
    },
  };
}

describe("protected SDK verifier producer identity", () => {
  it("derives the exact execution from the persisted assignment and controls same-token retries", async () => {
    const h = fixture();
    const row = await h.store.create(
      execution,
      new Date(Date.now() + 15 * 60_000),
    );
    const token = await h.issuer.issue(row.assignmentId);
    const first = await h.authenticator.authenticate(token);
    const retry = await h.authenticator.authenticate(token);
    expect(first.execution).toEqual(execution);
    expect(first).toEqual(retry);
    expect(first).toMatchObject({
      producer: "reviewrouter-verifier",
      issuer: "reviewrouter-sdk-verifier-workload",
      subject: "reviewrouter-verifier",
    });
    expect(h.rows.get(row.assignmentId)?.execution).toEqual(execution);
  });

  it.each([
    ["tenantId", "other-tenant"],
    ["repositoryId", "other-repo"],
    ["pullRequest", 18],
    ["githubRepositoryId", "101"],
    ["installationId", "201"],
    ["subject", "other-runner"],
    ["runId", "301"],
    ["runAttempt", "2"],
    ["verifierRevision", "4".repeat(40)],
    ["sourceCommit", "5".repeat(40)],
    ["sourceTree", "6".repeat(40)],
  ] as const)("rejects changed persisted %s", async (field, value) => {
    const h = fixture();
    const row = await h.store.create(
      execution,
      new Date(Date.now() + 15 * 60_000),
    );
    const token = await h.issuer.issue(row.assignmentId);
    h.rows.set(row.assignmentId, {
      ...row,
      execution: { ...execution, [field]: value },
    });
    await expect(h.authenticator.authenticate(token)).rejects.toThrow(
      "credential_rejected",
    );
  });

  it("rejects revocation, assignment expiry, credential expiry, and missing assignment", async () => {
    const h = fixture();
    const row = await h.store.create(
      execution,
      new Date(Date.now() + 15 * 60_000),
    );
    const token = await h.issuer.issue(row.assignmentId);
    h.rows.delete(row.assignmentId);
    await expect(h.authenticator.authenticate(token)).rejects.toThrow(
      "credential_rejected",
    );
    h.rows.set(row.assignmentId, row);
    await h.store.revoke(row.assignmentId);
    await expect(h.authenticator.authenticate(token)).rejects.toThrow(
      "credential_rejected",
    );
    h.rows.set(row.assignmentId, {
      ...row,
      expiresAt: new Date(Date.now() - 1),
    });
    await expect(h.authenticator.authenticate(token)).rejects.toThrow(
      "credential_rejected",
    );
    h.rows.set(row.assignmentId, row);
    h.setNow(new Date(Date.now() + 6 * 60_000));
    await expect(h.authenticator.authenticate(token)).rejects.toThrow(
      "credential_rejected",
    );
  });

  it("supersedes a stale assignment for the same protected run and attempt", async () => {
    const h = fixture();
    const first = await h.store.create(
      execution,
      new Date(Date.now() + 15 * 60_000),
    );
    const oldToken = await h.issuer.issue(first.assignmentId);
    const replacementExecution = {
      ...execution,
      runAttempt: "2",
      sourceTree: "9".repeat(40),
    };
    const replacement = await h.store.create(
      replacementExecution,
      new Date(Date.now() + 15 * 60_000),
    );
    expect(h.rows.get(first.assignmentId)?.revokedAt).toBeInstanceOf(Date);
    await expect(h.authenticator.authenticate(oldToken)).rejects.toThrow(
      "credential_rejected",
    );
    const newToken = await h.issuer.issue(replacement.assignmentId);
    expect((await h.authenticator.authenticate(newToken)).execution).toEqual(
      replacementExecution,
    );
  });

  it("rejects malformed, cross-scope and candidate OIDC credentials before custody writes", async () => {
    const h = fixture();
    const row = await h.store.create(
      execution,
      new Date(Date.now() + 15 * 60_000),
    );
    const valid = await h.issuer.issue(row.assignmentId);
    const payload = decodeJwt(valid);
    const wrongIssuer = await new SignJWT({ ...payload, iss: "wrong-issuer" })
      .setProtectedHeader({ alg: "EdDSA", typ: "rr-sdk-verifier+jwt" })
      .sign(h.keys.privateKey);
    const wrongAudience = await new SignJWT({
      ...payload,
      aud: "wrong-audience",
    })
      .setProtectedHeader({ alg: "EdDSA", typ: "rr-sdk-verifier+jwt" })
      .sign(h.keys.privateKey);
    const candidateKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const candidate = await new SignJWT({ assignmentId: row.assignmentId })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer("https://token.actions.githubusercontent.com")
      .setAudience("reviewrouter")
      .setExpirationTime("5m")
      .sign(candidateKey.privateKey);
    const writer = new PrismaSdkGrowthVerifierEvidenceCustody(
      h.db as never,
      h.authenticator,
      new SdkGrowthVerifierAuthorityPolicy(),
    );
    const input = {
      expectedAuthorityEpoch: 1,
      candidateArchive: Buffer.from("candidate"),
      releasedArchive: Buffer.from("released"),
      toolArchive: Buffer.from("tool"),
      installedDistributionWire: Buffer.from("distribution"),
    };
    const tampered =
      valid.slice(0, valid.lastIndexOf(".") + 1) +
      (valid[valid.lastIndexOf(".") + 1] === "a" ? "b" : "a") +
      valid.slice(valid.lastIndexOf(".") + 2);
    for (const credential of [
      "bad",
      candidate,
      tampered,
      wrongIssuer,
      wrongAudience,
    ]) {
      await expect(writer.retainEvidence(credential, input)).rejects.toThrow(
        "credential_rejected",
      );
      await expect(
        writer.retainFinalizedReport(credential, {
          expectedAuthorityEpoch: 1,
          requestDigest: `sha256:${"a".repeat(64)}`,
          grantDigest: `sha256:${"b".repeat(64)}`,
          finalizedReport: Buffer.from("report"),
          decision: {
            outcome: "passed",
            coverage: "complete",
            coveredScopes: ["public-api"],
            phases: ["authority"],
          },
        }),
      ).rejects.toThrow("credential_rejected");
    }
    // A valid credential for another protected assignment resolves that exact
    // assignment, never a caller supplied execution.
    const other = await h.store.create(
      { ...execution, tenantId: "other-tenant" },
      new Date(Date.now() + 15 * 60_000),
    );
    const otherToken = await h.issuer.issue(other.assignmentId);
    expect(
      (await h.authenticator.authenticate(otherToken)).execution.tenantId,
    ).toBe("other-tenant");
    expect(h.writes).toEqual([]);
  });
});
