import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  HostedV4AuthorityBridge,
  type HostedV4Authorization,
  type HostedV4LiveAuthority,
} from "@reviewrouter/features-hosted-account-pool";
import { registerHostedV4ReadRoutes } from "./hosted-v4-read-routes.js";

const authorization: HostedV4Authorization = {
  authorizationId: "authorization-1",
  workspaceId: "workspace-1",
  repositoryConnectionId: "repository-1",
  scmRepositoryIdentityId: "scm-1",
  pullRequestNumber: 7,
  headSha: "a".repeat(40),
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
  owner: "owner",
  repo: "repo",
  providerInstanceId: "hosted-pool:repository:123",
  bindingId: "binding-1",
  bindingVersion: 2,
  bindingActive: true,
  poolActive: true,
  selected: true,
  installationActive: true,
  pullRequestNumber: 7,
  headSha: authorization.headSha,
  reviewRevisionHash: authorization.reviewRevisionHash,
  producerReleaseId: authorization.producerReleaseId,
  producerReleaseRegistered: true,
};

describe("hosted v4 private read routes", () => {
  // A rollout gate regression would expose the private route at default boot.
  it("does not register routes while disabled", async () => {
    const app = Fastify();
    await registerHostedV4ReadRoutes(app, { enabled: false });
    const response = await app.inject({
      method: "POST",
      url: "/api/hosted/v4/read-capabilities",
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  // Without a second authority check, revocation during SCM I/O leaks file bytes.
  it("withholds a file when authorization is revoked during the read", async () => {
    let current = authorization;
    const bridge = new HostedV4AuthorityBridge(
      {
        resolveAuthorizationToken: async (token) =>
          token === "v2-authorization-token" ? current : null,
        findAuthorization: async () => current,
        readLiveAuthority: async () => live,
      },
      Buffer.alloc(32, 4),
      () => new Date("2026-09-24T12:00:00.000Z"),
    );
    const app = Fastify();
    await registerHostedV4ReadRoutes(app, {
      enabled: true,
      bridge,
      scm: {
        readFile: async (scope, path) => {
          current = { ...current, state: "revoked" };
          return {
            path,
            headSha: scope.headSha,
            blobSha: "b".repeat(40),
            contentBase64: Buffer.from("secret").toString("base64"),
          };
        },
      },
    });
    const admitted = await app.inject({
      method: "POST",
      url: "/api/hosted/v4/read-capabilities",
      payload: {
        authorizationToken: "v2-authorization-token",
        repositoryConnectionId: "repository-1",
        providerInstanceId: "hosted-pool:repository:123",
        bindingId: "binding-1",
        bindingVersion: 2,
      },
    });
    expect(admitted.statusCode).toBe(201);
    expect(admitted.json()).toEqual({
      capability: expect.any(String),
      expiresAt: "2026-09-24T12:05:00.000Z",
    });
    const read = await app.inject({
      method: "POST",
      url: "/api/hosted/v4/files/read",
      payload: { capability: admitted.json().capability, path: "src/index.ts" },
    });
    expect(read.statusCode).toBe(403);
    expect(read.body).not.toContain("secret");
    expect(read.headers["cache-control"]).toBe("no-store");
    await app.close();
  });
});
