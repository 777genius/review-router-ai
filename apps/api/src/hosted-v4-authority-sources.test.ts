import { describe, expect, it } from "vitest";
import type { HostedV4Authorization } from "@reviewrouter/features-hosted-account-pool";
import { createHostedV4AuthoritySources } from "./hosted-v4-authority-sources";

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

function fixture() {
  let installationWorkspaceId = "workspace-1";
  let sourceTrust = "trusted_default_branch_revision";
  let currentReleaseId = "release-1";
  let releaseActionSha = "f".repeat(40);
  let currentHead = authorization.headSha;
  let bindingStatus = "active";
  let beforeReleaseRead = async () => {};
  const sources = createHostedV4AuthoritySources({
    prisma: {
      repositoryConnection: {
        findUnique: async () => ({
          id: "repository-1",
          workspaceId: "workspace-1",
          provider: "github",
          scmRepositoryIdentityId: "scm-1",
          githubRepositoryId: 123n,
          owner: "owner",
          name: "repo",
          selected: true,
          archived: false,
          installation: {
            githubInstallationId: 456n,
            status: "active",
            workspaceId: installationWorkspaceId,
          },
          hostedCodexBindings: [
            {
              id: "binding-1",
              revision: 2n,
              status: bindingStatus,
              attestedGithubRepositoryId: 123n,
              attestedBindingRevision: 2n,
              workflowPath: ".github/workflows/reviewrouter-codex.yml",
              workflowActionRef: `777genius/review-router@${"f".repeat(40)}`,
              workflowSourceCommitSha: "a".repeat(40),
              workflowSourceBlobSha: "b".repeat(40),
              workflowSourceSha256: "c".repeat(64),
              workflowSemanticSha256: "d".repeat(64),
              workflowSourceTrust: sourceTrust,
              pool: { status: "active" },
            },
          ],
        }),
      },
    } as never,
    authorizations: {
      resolveReviewRunAuthorizationToken: async () => ({ status: "invalid" }),
    } as never,
    authorizationQueries: {
      findReviewRunAuthorizationById: async () => null,
    } as never,
    revisions: {
      resolve: async () => ({
        status: "resolved",
        pullRequestNumber: 7,
        baseSha: "b".repeat(40),
        mergeBaseSha: "c".repeat(40),
        headSha: currentHead,
        reviewRevisionHash: "revision-1",
      }),
    } as never,
    releases: {
      findProducerReleaseById: async () => {
        await beforeReleaseRead();
        return { state: "registered", actionCommitSha: releaseActionSha };
      },
    } as never,
    currentProducerReleaseId: async () => currentReleaseId,
  });
  return {
    sources,
    setInstallationWorkspaceId: (value: string) => {
      installationWorkspaceId = value;
    },
    setSourceTrust: (value: string) => {
      sourceTrust = value;
    },
    setCurrentReleaseId: (value: string) => {
      currentReleaseId = value;
    },
    setReleaseActionSha: (value: string) => {
      releaseActionSha = value;
    },
    setCurrentHead: (value: string) => {
      currentHead = value;
    },
    setBindingStatus: (value: string) => {
      bindingStatus = value;
    },
    setBeforeReleaseRead: (value: () => Promise<void>) => {
      beforeReleaseRead = value;
    },
  };
}

describe("hosted v4 current-state source", () => {
  it("resolves an attested binding, current head, and selected release", async () => {
    const f = fixture();
    await expect(
      f.sources.readLiveAuthority(authorization),
    ).resolves.toMatchObject({
      githubRepositoryId: "123",
      githubInstallationId: "456",
      bindingId: "binding-1",
      bindingVersion: 2,
      headSha: authorization.headSha,
      producerReleaseId: "release-1",
      producerReleaseRegistered: true,
    });
    f.setCurrentHead("e".repeat(40));
    f.setCurrentReleaseId("release-2");
    await expect(
      f.sources.readLiveAuthority(authorization),
    ).resolves.toMatchObject({
      headSha: "e".repeat(40),
      producerReleaseId: "release-2",
    });
  });

  it("fails closed for a foreign installation or invalid binding attestation", async () => {
    const f = fixture();
    f.setInstallationWorkspaceId("other-workspace");
    await expect(
      f.sources.readLiveAuthority(authorization),
    ).resolves.toBeNull();
    f.setInstallationWorkspaceId("workspace-1");
    f.setSourceTrust("untrusted");
    await expect(
      f.sources.readLiveAuthority(authorization),
    ).resolves.toBeNull();
  });

  it("rejects a registered producer release pinned to another Action commit", async () => {
    const f = fixture();
    f.setReleaseActionSha("e".repeat(40));
    await expect(
      f.sources.readLiveAuthority(authorization),
    ).resolves.toMatchObject({
      producerReleaseRegistered: false,
    });
  });

  it("rejects binding deactivation while release resolution is pending", async () => {
    const f = fixture();
    let signalEntered!: () => void;
    let releaseLookup!: () => void;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });
    f.setBeforeReleaseRead(async () => {
      signalEntered();
      await held;
    });

    const reading = f.sources.readLiveAuthority(authorization);
    await entered;
    f.setBindingStatus("revoked");
    releaseLookup();
    await expect(reading).resolves.toBeNull();
  });
});
