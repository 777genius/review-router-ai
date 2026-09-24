import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  HostedV4AuthorityBridge,
  hostedV4ScmReadPermissions,
  type HostedV4Authorization,
  type HostedV4LiveAuthority,
} from "../application/use-cases/hosted-v4-authority-bridge";

const head = "a".repeat(40);
const authorization: HostedV4Authorization = {
  authorizationId: "authorization-1",
  workspaceId: "workspace-1",
  repositoryConnectionId: "repository-1",
  scmRepositoryIdentityId: "scm-1",
  pullRequestNumber: 7,
  headSha: head,
  reviewRevisionHash: "revision-1",
  producerReleaseId: "release-1",
  trustDomain: "trusted_managed",
  investigationCodexRecordingAllowed: true,
  state: "active",
  expiresAt: new Date("2026-09-24T12:15:00.000Z"),
};
const live: HostedV4LiveAuthority = {
  workspaceId: "workspace-1",
  repositoryConnectionId: "repository-1",
  scmRepositoryIdentityId: "scm-1",
  githubRepositoryId: "123",
  githubInstallationId: "456",
  providerInstanceId: "hosted-pool:repository:123",
  bindingId: "binding-1",
  bindingVersion: 2,
  bindingActive: true,
  poolActive: true,
  selected: true,
  installationActive: true,
  pullRequestNumber: 7,
  headSha: head,
  reviewRevisionHash: "revision-1",
  producerReleaseId: "release-1",
  producerReleaseRegistered: true,
};

function fixture(signingKey = Buffer.alloc(32, 42)) {
  let now = new Date("2026-09-24T12:00:00.000Z");
  let currentAuthorization: HostedV4Authorization | null = authorization;
  let currentLive: HostedV4LiveAuthority | null = live;
  let readLive = async () => currentLive;
  const bridge = new HostedV4AuthorityBridge(
    {
      resolveAuthorizationToken: async (token) =>
        token === "valid-v2-token" ? currentAuthorization : null,
      findAuthorization: async (id) =>
        id === currentAuthorization?.authorizationId
          ? currentAuthorization
          : null,
      readLiveAuthority: async () => readLive(),
    },
    signingKey,
    () => now,
  );
  const input = {
    authorizationToken: "valid-v2-token",
    repositoryConnectionId: "repository-1",
    providerInstanceId: "hosted-pool:repository:123",
    bindingId: "binding-1",
    bindingVersion: 2,
  };
  return {
    bridge,
    input,
    setNow: (value: Date) => {
      now = value;
    },
    setAuthorization: (value: HostedV4Authorization | null) => {
      currentAuthorization = value;
    },
    setLive: (value: HostedV4LiveAuthority | null) => {
      currentLive = value;
    },
    setLiveReader: (value: () => Promise<HostedV4LiveAuthority | null>) => {
      readLive = value;
    },
  };
}

describe("hosted v4 authority bridge", () => {
  it("requires an existing v2 token and issues a five-minute repository-scoped read capability", async () => {
    const f = fixture();
    await expect(
      f.bridge.admit({ ...f.input, authorizationToken: "relay-grant" }),
    ).rejects.toThrow("hosted_v4_authority_denied");
    const issued = await f.bridge.admit(f.input);
    expect(issued.scope).toMatchObject({
      authorizationId: "authorization-1",
      githubRepositoryId: "123",
      bindingVersion: 2,
      headSha: head,
      expiresAt: "2026-09-24T12:05:00.000Z",
    });
    await expect(f.bridge.resolveRead(issued.capability)).resolves.toEqual(
      issued.scope,
    );
    expect(hostedV4ScmReadPermissions).toEqual({
      contents: "read",
      pull_requests: "read",
    });
    expect(Object.keys(hostedV4ScmReadPermissions)).not.toEqual(
      expect.arrayContaining(["issues", "statuses"]),
    );
  });

  it.each([
    ["cross repository", { repositoryConnectionId: "other-repository" }],
    ["provider instance", { providerInstanceId: "hosted-pool:repository:999" }],
    ["binding identity", { bindingId: "binding-other" }],
    ["binding version", { bindingVersion: 3 }],
  ])("denies %s on initial admission", async (_name, patch) => {
    const f = fixture();
    await expect(f.bridge.admit({ ...f.input, ...patch })).rejects.toThrow(
      "hosted_v4_authority_denied",
    );
  });

  it.each([
    ["repository", { repositoryConnectionId: "other-repository" }],
    ["SCM identity", { scmRepositoryIdentityId: "scm-other" }],
    ["binding", { bindingVersion: 3 }],
    ["head", { headSha: "b".repeat(40) }],
    ["revision", { reviewRevisionHash: "revision-2" }],
    ["release", { producerReleaseId: "release-2" }],
    ["release revocation", { producerReleaseRegistered: false }],
    ["pool deactivation", { poolActive: false }],
  ])("denies refresh after %s changes", async (_name, patch) => {
    const f = fixture();
    const issued = await f.bridge.admit(f.input);
    f.setLive({ ...live, ...patch });
    await expect(
      f.bridge.refresh(issued.capability, "valid-v2-token"),
    ).rejects.toThrow("hosted_v4_authority_denied");
    await expect(f.bridge.resolveRead(issued.capability)).rejects.toThrow(
      "hosted_v4_authority_denied",
    );
  });

  it.each([
    ["revoked", { state: "revoked" }],
    ["expired", { expiresAt: new Date("2026-09-24T11:59:59.000Z") }],
    ["investigation disabled", { investigationCodexRecordingAllowed: false }],
    ["untrusted contribution", { trustDomain: "untrusted_contribution" }],
  ])(
    "denies %s authorization on admission and refresh",
    async (_name, patch) => {
      const f = fixture();
      const issued = await f.bridge.admit(f.input);
      f.setAuthorization({ ...authorization, ...patch });
      await expect(f.bridge.admit(f.input)).rejects.toThrow(
        "hosted_v4_authority_denied",
      );
      await expect(
        f.bridge.refresh(issued.capability, "valid-v2-token"),
      ).rejects.toThrow("hosted_v4_authority_denied");
    },
  );

  it("rejects expired and modified capabilities and refreshes only within authorization lifetime", async () => {
    const f = fixture();
    const issued = await f.bridge.admit(f.input);
    await expect(
      f.bridge.refresh(`${issued.capability}x`, "valid-v2-token"),
    ).rejects.toThrow("hosted_v4_authority_denied");
    await expect(
      f.bridge.refresh(issued.capability, "relay-grant"),
    ).rejects.toThrow("hosted_v4_authority_denied");
    f.setNow(new Date("2026-09-24T12:04:00.000Z"));
    const refreshed = await f.bridge.refresh(
      issued.capability,
      "valid-v2-token",
    );
    expect(refreshed.scope.expiresAt).toBe("2026-09-24T12:09:00.000Z");
    f.setNow(new Date("2026-09-24T12:05:00.000Z"));
    await expect(
      f.bridge.refresh(issued.capability, "valid-v2-token"),
    ).rejects.toThrow("hosted_v4_authority_denied");
  });

  it("rejects valid-format payload/signature tampering, wrong keys and malformed signed JSON", async () => {
    const f = fixture();
    const issued = await f.bridge.admit(f.input);
    const [payload, signature] = issued.capability.split(".");
    const changedPayload = Buffer.from(
      JSON.stringify({ ...issued.scope, version: 1, headSha: "b".repeat(40) }),
    ).toString("base64url");
    const changedSignature = `${signature![0] === "A" ? "B" : "A"}${signature!.slice(1)}`;
    await expect(
      f.bridge.resolveRead(`${changedPayload}.${signature}`),
    ).rejects.toThrow("hosted_v4_authority_denied");
    await expect(
      f.bridge.resolveRead(`${payload}.${changedSignature}`),
    ).rejects.toThrow("hosted_v4_authority_denied");
    await expect(
      fixture(Buffer.alloc(32, 43)).bridge.resolveRead(issued.capability),
    ).rejects.toThrow("hosted_v4_authority_denied");

    const malformedPayload = Buffer.from("{", "utf8").toString("base64url");
    const malformedSignature = createHmac("sha256", Buffer.alloc(32, 42))
      .update("hosted-v4-scm-read-v1\0")
      .update(malformedPayload)
      .digest("base64url");
    await expect(
      f.bridge.resolveRead(`${malformedPayload}.${malformedSignature}`),
    ).rejects.toThrow("hosted_v4_authority_denied");
  });

  it("denies a read when authorization is revoked during live authority lookup", async () => {
    const f = fixture();
    const issued = await f.bridge.admit(f.input);
    let signalEntered!: () => void;
    let releaseLookup!: () => void;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const heldLookup = new Promise<HostedV4LiveAuthority>((resolve) => {
      releaseLookup = () => resolve(live);
    });
    f.setLiveReader(async () => {
      signalEntered();
      return heldLookup;
    });

    const reading = f.bridge.resolveRead(issued.capability);
    await entered;
    f.setAuthorization({ ...authorization, state: "revoked" });
    releaseLookup();
    await expect(reading).rejects.toThrow("hosted_v4_authority_denied");
  });
});
