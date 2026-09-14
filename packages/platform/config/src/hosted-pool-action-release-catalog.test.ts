import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createGithubHostedPoolActionCatalog,
  parseHostedPoolActionChannel,
  resolveHostedPoolActionRelease,
  resolveHostedPoolActionReleaseForProvision,
  type HostedPoolActionRelease,
} from "./hosted-pool-action-release-catalog";

const sha = "a".repeat(40);
const otherSha = "b".repeat(40);
const dist = "c".repeat(64);
const distBytes = "immutable hosted action dist\n";
const distSha256 = createHash("sha256").update(distBytes).digest("hex");

function release(
  tag = "v1.0.146",
  commitSha = sha,
  distSha256Value = dist,
): HostedPoolActionRelease {
  return {
    repository: "777genius/review-router",
    tag,
    commitSha,
    distSha256: distSha256Value,
    actionRef: `777genius/review-router@${commitSha}`,
  };
}

describe("hosted pool action release channel", () => {
  it("treats main and latest as the official release channel", () => {
    expect(parseHostedPoolActionChannel("main")).toEqual({
      kind: "official_latest",
    });
    expect(parseHostedPoolActionChannel("LATEST")).toEqual({
      kind: "official_latest",
    });
    expect(parseHostedPoolActionChannel("v1.0.146")).toEqual({
      kind: "release_tag",
      tag: "v1.0.146",
    });
    expect(() => parseHostedPoolActionChannel("v1")).toThrow(
      "invalid_env:REVIEW_ROUTER_HOSTED_POOL_ACTION_TAG",
    );
    expect(() => parseHostedPoolActionChannel("canary")).toThrow(
      "invalid_env:REVIEW_ROUTER_HOSTED_POOL_ACTION_TAG",
    );
  });

  it("records a main snapshot at boot without fetching", () => {
    expect(
      resolveHostedPoolActionRelease({
        REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF: `777genius/review-router@${sha}`,
        REVIEW_ROUTER_HOSTED_POOL_ACTION_TAG: "MAIN",
        REVIEW_ROUTER_HOSTED_POOL_ACTION_SHA: sha,
        REVIEW_ROUTER_HOSTED_POOL_ACTION_DIST_SHA256: dist,
      }),
    ).toEqual(release("main"));
  });

  it("stays offline for a complete version tag snapshot", async () => {
    const catalog = {
      latestOfficialRelease: async () => {
        throw new Error("catalog_should_not_run");
      },
      releaseForTag: async () => {
        throw new Error("catalog_should_not_run");
      },
    };
    await expect(
      resolveHostedPoolActionReleaseForProvision(
        {
          REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF: `777genius/review-router@${sha}`,
          REVIEW_ROUTER_HOSTED_POOL_ACTION_TAG: "v1.0.146",
          REVIEW_ROUTER_HOSTED_POOL_ACTION_SHA: sha,
          REVIEW_ROUTER_HOSTED_POOL_ACTION_DIST_SHA256: dist,
        },
        catalog,
      ),
    ).resolves.toEqual(release());
  });

  it("fills SHA and dist from a version tag when the snapshot is omitted", async () => {
    const catalog = {
      latestOfficialRelease: async () => {
        throw new Error("catalog_should_not_run");
      },
      releaseForTag: async (tag: string) => release(tag),
    };
    await expect(
      resolveHostedPoolActionReleaseForProvision(
        { REVIEW_ROUTER_HOSTED_POOL_ACTION_TAG: "v1.0.146" },
        catalog,
      ),
    ).resolves.toEqual(release());
  });

  it("resolves main to the official release SHA instead of a branch ref", async () => {
    const catalog = {
      latestOfficialRelease: async () => release(),
      releaseForTag: async () => {
        throw new Error("catalog_should_not_run");
      },
    };
    const resolved = await resolveHostedPoolActionReleaseForProvision(
      { REVIEW_ROUTER_HOSTED_POOL_ACTION_TAG: "main" },
      catalog,
    );
    expect(resolved.tag).toBe("v1.0.146");
    expect(resolved.commitSha).toBe(sha);
    expect(resolved.actionRef).toBe(`777genius/review-router@${sha}`);
    expect(resolved.actionRef.endsWith("@main")).toBe(false);
  });

  it("fails closed when a recorded snapshot drifted from the official catalog", async () => {
    const catalog = {
      latestOfficialRelease: async () => release(),
      releaseForTag: async () => release(),
    };
    await expect(
      resolveHostedPoolActionReleaseForProvision(
        {
          REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF: `777genius/review-router@${otherSha}`,
          REVIEW_ROUTER_HOSTED_POOL_ACTION_TAG: "main",
          REVIEW_ROUTER_HOSTED_POOL_ACTION_SHA: otherSha,
          REVIEW_ROUTER_HOSTED_POOL_ACTION_DIST_SHA256: dist,
        },
        catalog,
      ),
    ).rejects.toThrow("hosted_pool_action_release_sha_mismatch");
  });

  it("requires a catalog when main cannot be resolved from a local snapshot", async () => {
    await expect(
      resolveHostedPoolActionReleaseForProvision({
        REVIEW_ROUTER_HOSTED_POOL_ACTION_TAG: "main",
      }),
    ).rejects.toThrow("hosted_pool_action_release_catalog_required");
  });
});

describe("GitHub hosted pool action catalog", () => {
  it("reads the latest official tag, commit, and dist digest", async () => {
    const requested: string[] = [];
    const catalog = createGithubHostedPoolActionCatalog({
      fetchImpl: async (url) => {
        requested.push(String(url));
        return githubFetch(String(url));
      },
    });
    await expect(catalog.latestOfficialRelease()).resolves.toEqual(
      release("v1.0.146", sha, distSha256),
    );
    expect(requested).toEqual([
      "https://api.github.com/repos/777genius/review-router/releases/latest",
      "https://api.github.com/repos/777genius/review-router/releases/tags/v1.0.146",
      "https://api.github.com/repos/777genius/review-router/commits/v1.0.146",
      `https://raw.githubusercontent.com/777genius/review-router/${sha}/dist/index.js`,
    ]);
  });

  it("rejects a prerelease as unofficial", async () => {
    const catalog = createGithubHostedPoolActionCatalog({
      fetchImpl: async () =>
        jsonResponse({
          tag_name: "v1.0.146",
          prerelease: true,
          draft: false,
        }),
    });
    await expect(catalog.latestOfficialRelease()).rejects.toThrow(
      "hosted_pool_action_release_not_official",
    );
  });
});

function githubFetch(url: string): Response {
  if (
    url.endsWith("/releases/latest") ||
    url.endsWith("/releases/tags/v1.0.146")
  ) {
    return jsonResponse({
      tag_name: "v1.0.146",
      draft: false,
      prerelease: false,
    });
  }
  if (url.endsWith("/commits/v1.0.146")) {
    return jsonResponse({ sha });
  }
  if (url.endsWith("/dist/index.js")) {
    return new Response(distBytes, { status: 200 });
  }
  return new Response("missing", { status: 404 });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
