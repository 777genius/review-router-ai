import { describe, expect, it } from "vitest";
import {
  G1OperatorCredentialAuthenticator,
  hashG1OperatorCredential,
  type G1OperatorCredentialRow,
} from "../infrastructure/prisma/prisma-operator-credential.js";

const id = "test_operator_0001";
const token = `g1.${id}.${Buffer.alloc(32, 7).toString("base64url")}`;
const replacement = `g1.${id}.${Buffer.alloc(32, 8).toString("base64url")}`;
const scope = {
  tenantId: "test-tenant",
  repositoryId: "test-repo",
  pullRequest: 42,
};

function fixture(now: () => number = () => 100) {
  let row: G1OperatorCredentialRow | null = {
    credentialId: id,
    generation: 1n,
    verifierSha256: hashG1OperatorCredential(token).verifierSha256,
    disabled: false,
    expiresAtMs: 1_000n,
    ...scope,
    pullRequest: 42n,
    githubRepositoryId: "123",
    installationId: "456",
    issuer: "test-control-plane",
    subject: "test-owner",
    allowedOperations: ["provision"],
  };
  const authenticator = new G1OperatorCredentialAuthenticator(
    {
      async findCredential(credentialId) {
        return credentialId === id ? row : null;
      },
    },
    now,
  );
  return {
    authenticator,
    get row() {
      return row;
    },
    set row(value) {
      row = value;
    },
  };
}

describe("dormant G1 operator credential", () => {
  it("derives a principal and separate fence from a matching durable verifier", async () => {
    const h = fixture();
    const result = await h.authenticator.authenticateWithFence(
      token,
      scope,
      "provision",
    );
    expect(result).toEqual({
      principal: {
        issuer: "test-control-plane",
        subject: "test-owner",
        authenticationId: `g1:${id}:1`,
        tenantId: "test-tenant",
        repositoryId: "test-repo",
        githubRepositoryId: "123",
        installationId: "456",
      },
      fence: { credentialId: id, generation: 1n },
    });
    expect(Object.keys(result.principal)).not.toContain("generation");
    expect(Object.values(h.row!)).not.toContain(token);
    expect(h.row!.verifierSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects missing, malformed, wrong, disabled, and rotated credentials", async () => {
    const h = fixture();
    const rejects = async (value: unknown) =>
      expect(
        h.authenticator.authenticateWithFence(value, scope, "provision"),
      ).rejects.toMatchObject({ code: "owner-evidence" });
    await rejects(undefined);
    await rejects(
      `g1.test_missing_0001.${Buffer.alloc(32, 7).toString("base64url")}`,
    );
    await rejects(replacement);
    h.row = { ...h.row!, disabled: true, generation: 2n };
    await rejects(token);
    h.row = {
      ...h.row!,
      disabled: false,
      generation: 3n,
      verifierSha256: hashG1OperatorCredential(replacement).verifierSha256,
    };
    await rejects(token);
    await expect(
      h.authenticator.authenticateWithFence(replacement, scope, "provision"),
    ).resolves.toMatchObject({ fence: { generation: 3n } });
  });

  it("rejects operation and exact scope mismatches", async () => {
    const h = fixture();
    for (const [requestScope, operation] of [
      [scope, "owner-revocation"],
      [{ ...scope, tenantId: "other" }, "provision"],
      [{ ...scope, repositoryId: "other" }, "provision"],
      [{ ...scope, pullRequest: 43 }, "provision"],
    ] as const) {
      await expect(
        h.authenticator.authenticateWithFence(token, requestScope, operation),
      ).rejects.toMatchObject({ code: "owner-evidence" });
    }
  });

  it("accepts immediately before expiry and rejects at expiry", async () => {
    let now = 999;
    const h = fixture(() => now);
    await expect(
      h.authenticator.authenticateWithFence(token, scope, "provision"),
    ).resolves.toMatchObject({ fence: { generation: 1n } });
    now = 1_000;
    await expect(
      h.authenticator.authenticateWithFence(token, scope, "provision"),
    ).rejects.toMatchObject({ code: "owner-evidence" });
  });
});
