import { createHash } from "node:crypto";

export const hostedPoolActionRepository = "777genius/review-router";

const hostedPoolReleaseTagPattern = /^v[1-9][0-9]*\.[0-9]+\.[0-9]+$/u;
const officialLatestChannelPattern = /^(?:main|latest)$/iu;
const githubApiOrigin = "https://api.github.com";
const githubRawOrigin = "https://raw.githubusercontent.com";
const distPath = "dist/index.js";

export type HostedPoolActionRelease = Readonly<{
  repository: typeof hostedPoolActionRepository;
  tag: string;
  commitSha: string;
  distSha256: string;
  actionRef: string;
}>;

export type HostedPoolActionChannel =
  | { readonly kind: "official_latest" }
  | { readonly kind: "release_tag"; readonly tag: string };

export type HostedPoolPublicActionCatalog = {
  latestOfficialRelease(): Promise<HostedPoolActionRelease>;
  releaseForTag(tag: string): Promise<HostedPoolActionRelease>;
};

type ReviewRouterActionRefEnv = {
  readonly REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF?: string | undefined;
  readonly REVIEW_ROUTER_HOSTED_POOL_ACTION_TAG?: string | undefined;
  readonly REVIEW_ROUTER_HOSTED_POOL_ACTION_SHA?: string | undefined;
  readonly REVIEW_ROUTER_HOSTED_POOL_ACTION_DIST_SHA256?: string | undefined;
  readonly [key: string]: string | undefined;
};

/**
 * Resolves the independently recorded public Action release consumed by the
 * hosted pool. The mutable general Action channel and an unpaired rotating SHA
 * are deliberately insufficient for hosted credential custody.
 */
export function resolveHostedPoolActionRelease(
  input: ReviewRouterActionRefEnv = process.env,
): HostedPoolActionRelease {
  const tag = input.REVIEW_ROUTER_HOSTED_POOL_ACTION_TAG?.trim() ?? "";
  const channel = parseHostedPoolActionChannel(tag);
  const commitSha =
    input.REVIEW_ROUTER_HOSTED_POOL_ACTION_SHA?.trim().toLowerCase() ?? "";
  const distSha256 =
    input.REVIEW_ROUTER_HOSTED_POOL_ACTION_DIST_SHA256?.trim().toLowerCase() ??
    "";
  if (!/^[a-f0-9]{40}$/u.test(commitSha)) {
    throw new Error("invalid_env:REVIEW_ROUTER_HOSTED_POOL_ACTION_SHA");
  }
  if (!/^[a-f0-9]{64}$/u.test(distSha256)) {
    throw new Error("invalid_env:REVIEW_ROUTER_HOSTED_POOL_ACTION_DIST_SHA256");
  }
  const actionRef = recordedRotatingActionRef(input);
  if (actionRef !== `${hostedPoolActionRepository}@${commitSha}`) {
    throw new Error("hosted_pool_action_release_ref_mismatch");
  }
  return Object.freeze({
    repository: hostedPoolActionRepository,
    tag:
      channel.kind === "official_latest"
        ? tag.trim().toLowerCase()
        : channel.tag,
    commitSha,
    distSha256,
    actionRef,
  });
}

export function parseHostedPoolActionChannel(
  tag: string,
): HostedPoolActionChannel {
  const value = tag.trim();
  if (officialLatestChannelPattern.test(value))
    return { kind: "official_latest" };
  if (hostedPoolReleaseTagPattern.test(value))
    return { kind: "release_tag", tag: value };
  throw new Error("invalid_env:REVIEW_ROUTER_HOSTED_POOL_ACTION_TAG");
}

export function hostedPoolActionReleaseSnapshotComplete(
  input: ReviewRouterActionRefEnv = process.env,
): boolean {
  const tag = input.REVIEW_ROUTER_HOSTED_POOL_ACTION_TAG?.trim() ?? "";
  const commitSha =
    input.REVIEW_ROUTER_HOSTED_POOL_ACTION_SHA?.trim().toLowerCase() ?? "";
  const distSha256 =
    input.REVIEW_ROUTER_HOSTED_POOL_ACTION_DIST_SHA256?.trim().toLowerCase() ??
    "";
  const rotating = input.REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF?.trim() ?? "";
  return (
    hostedPoolReleaseTagPattern.test(tag) &&
    /^[a-f0-9]{40}$/u.test(commitSha) &&
    /^[a-f0-9]{64}$/u.test(distSha256) &&
    rotating.length > 0
  );
}

/**
 * Connect/provision entry: a version tag with a complete recorded snapshot stays
 * offline. `main` / `latest` and a tag without SHA+dist always ask the public
 * Action catalog, then bake the returned 40-character SHA. The recorded env
 * snapshot, when present, must match.
 */
export async function resolveHostedPoolActionReleaseForProvision(
  input: ReviewRouterActionRefEnv = process.env,
  catalog?: HostedPoolPublicActionCatalog,
): Promise<HostedPoolActionRelease> {
  const tag = input.REVIEW_ROUTER_HOSTED_POOL_ACTION_TAG?.trim() ?? "";
  const channel = parseHostedPoolActionChannel(tag);
  if (
    channel.kind === "release_tag" &&
    hostedPoolActionReleaseSnapshotComplete(input)
  ) {
    return resolveHostedPoolActionRelease(input);
  }
  if (!catalog) throw new Error("hosted_pool_action_release_catalog_required");
  const fetched =
    channel.kind === "official_latest"
      ? await catalog.latestOfficialRelease()
      : await catalog.releaseForTag(channel.tag);
  return bindRecordedHostedPoolActionRelease(input, fetched);
}

export function createGithubHostedPoolActionCatalog(
  input: {
    readonly fetchImpl?: typeof fetch;
    readonly token?: string;
  } = {},
): HostedPoolPublicActionCatalog {
  const fetchImpl = input.fetchImpl ?? fetch;
  const token = input.token?.trim() ?? "";
  const read = async (tag: string): Promise<HostedPoolActionRelease> => {
    const releaseTag = hostedPoolReleaseTagPattern.test(tag)
      ? tag
      : await readLatestOfficialTag(fetchImpl, token);
    return readOfficialRelease(fetchImpl, token, releaseTag);
  };
  return {
    latestOfficialRelease: () => read("latest"),
    releaseForTag: (tag) => {
      if (!hostedPoolReleaseTagPattern.test(tag.trim())) {
        throw new Error("invalid_env:REVIEW_ROUTER_HOSTED_POOL_ACTION_TAG");
      }
      return read(tag.trim());
    },
  };
}

function bindRecordedHostedPoolActionRelease(
  input: ReviewRouterActionRefEnv,
  fetched: HostedPoolActionRelease,
): HostedPoolActionRelease {
  const recordedSha =
    input.REVIEW_ROUTER_HOSTED_POOL_ACTION_SHA?.trim().toLowerCase() ?? "";
  const recordedDist =
    input.REVIEW_ROUTER_HOSTED_POOL_ACTION_DIST_SHA256?.trim().toLowerCase() ??
    "";
  if (recordedSha && recordedSha !== fetched.commitSha) {
    throw new Error("hosted_pool_action_release_sha_mismatch");
  }
  if (recordedDist && recordedDist !== fetched.distSha256) {
    throw new Error("hosted_pool_action_release_dist_mismatch");
  }
  if (input.REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF?.trim()) {
    if (recordedRotatingActionRef(input) !== fetched.actionRef) {
      throw new Error("hosted_pool_action_release_ref_mismatch");
    }
  }
  return fetched;
}

function recordedRotatingActionRef(input: ReviewRouterActionRefEnv): string {
  const value = input.REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF?.trim() ?? "";
  if (!value) {
    throw new Error("missing_env:REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF");
  }
  const normalized = value.toLowerCase();
  const prefix = `${hostedPoolActionRepository}@`;
  const commitSha = normalized.slice(prefix.length);
  if (!normalized.startsWith(prefix) || !/^[a-f0-9]{40}$/u.test(commitSha)) {
    throw new Error("invalid_env:REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF");
  }
  return normalized;
}

async function readLatestOfficialTag(
  fetchImpl: typeof fetch,
  token: string,
): Promise<string> {
  const payload = await githubJson(
    fetchImpl,
    token,
    `${githubApiOrigin}/repos/${hostedPoolActionRepository}/releases/latest`,
  );
  return officialReleaseTag(payload);
}

async function readOfficialRelease(
  fetchImpl: typeof fetch,
  token: string,
  tag: string,
): Promise<HostedPoolActionRelease> {
  const payload = await githubJson(
    fetchImpl,
    token,
    `${githubApiOrigin}/repos/${hostedPoolActionRepository}/releases/tags/${encodeURIComponent(tag)}`,
  );
  const releaseTag = officialReleaseTag(payload);
  if (releaseTag !== tag)
    throw new Error("hosted_pool_action_release_not_official");
  const commitSha = await readTagCommitSha(fetchImpl, token, releaseTag);
  const distSha256 = await readDistSha256(fetchImpl, token, commitSha);
  return Object.freeze({
    repository: hostedPoolActionRepository,
    tag: releaseTag,
    commitSha,
    distSha256,
    actionRef: `${hostedPoolActionRepository}@${commitSha}`,
  });
}

function officialReleaseTag(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("hosted_pool_action_release_lookup_failed");
  }
  const record = payload as {
    readonly tag_name?: unknown;
    readonly draft?: unknown;
    readonly prerelease?: unknown;
  };
  if (record.draft === true || record.prerelease === true) {
    throw new Error("hosted_pool_action_release_not_official");
  }
  const tag = typeof record.tag_name === "string" ? record.tag_name.trim() : "";
  if (!hostedPoolReleaseTagPattern.test(tag)) {
    throw new Error("hosted_pool_action_release_not_official");
  }
  return tag;
}

async function readTagCommitSha(
  fetchImpl: typeof fetch,
  token: string,
  tag: string,
): Promise<string> {
  const payload = await githubJson(
    fetchImpl,
    token,
    `${githubApiOrigin}/repos/${hostedPoolActionRepository}/commits/${encodeURIComponent(tag)}`,
  );
  const sha =
    payload && typeof payload === "object" && "sha" in payload
      ? String((payload as { sha: unknown }).sha).toLowerCase()
      : "";
  if (!/^[a-f0-9]{40}$/u.test(sha)) {
    throw new Error("hosted_pool_action_commit_invalid");
  }
  return sha;
}

async function readDistSha256(
  fetchImpl: typeof fetch,
  token: string,
  commitSha: string,
): Promise<string> {
  const url = `${githubRawOrigin}/${hostedPoolActionRepository}/${commitSha}/${distPath}`;
  const response = await githubResponse(fetchImpl, token, url);
  if (response.status === 404)
    throw new Error("hosted_pool_action_dist_missing");
  if (!response.ok) throw new Error("hosted_pool_action_release_lookup_failed");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 1) throw new Error("hosted_pool_action_dist_missing");
  return createHash("sha256").update(bytes).digest("hex");
}

async function githubJson(
  fetchImpl: typeof fetch,
  token: string,
  url: string,
): Promise<unknown> {
  const response = await githubResponse(fetchImpl, token, url);
  if (response.status === 404)
    throw new Error("hosted_pool_action_release_not_found");
  if (!response.ok) throw new Error("hosted_pool_action_release_lookup_failed");
  try {
    return await response.json();
  } catch {
    throw new Error("hosted_pool_action_release_lookup_failed");
  }
}

async function githubResponse(
  fetchImpl: typeof fetch,
  token: string,
  url: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "review-router-hosted-pool-action-release",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    return await fetchImpl(url, { headers, redirect: "error" });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "hosted_pool_action_release_not_found" ||
        error.message === "hosted_pool_action_release_lookup_failed" ||
        error.message === "hosted_pool_action_release_not_official" ||
        error.message === "hosted_pool_action_dist_missing" ||
        error.message === "hosted_pool_action_commit_invalid")
    ) {
      throw error;
    }
    throw new Error("hosted_pool_action_release_lookup_failed");
  }
}
