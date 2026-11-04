import { createHash } from "node:crypto";

type WorkflowSourceErrorPrefix = "codex_rotating_workflow" | "hosted_workflow";

/** Decode provider responses only. Callers retain their identity and authority rechecks. */
export function readGitHubWorkflowRepositoryIdentity(
  data: unknown,
  errorPrefix: WorkflowSourceErrorPrefix,
) {
  const repository = data as {
    id?: unknown;
    full_name?: unknown;
    default_branch?: unknown;
  } | null;
  if (
    typeof repository?.id !== "number" ||
    !Number.isSafeInteger(repository.id) ||
    repository.id <= 0 ||
    typeof repository.full_name !== "string" ||
    typeof repository.default_branch !== "string" ||
    repository.default_branch.length === 0
  ) {
    throw new Error(`${errorPrefix}_repository_invalid_response`);
  }
  return {
    id: String(repository.id),
    fullName: repository.full_name,
    defaultBranch: repository.default_branch,
  };
}

export function readGitHubWorkflowCommitSha(
  data: unknown,
  errorPrefix: WorkflowSourceErrorPrefix,
): string {
  const sha = (data as { object?: { sha?: unknown } } | null)?.object?.sha;
  if (typeof sha !== "string" || !/^[a-f0-9]{40}$/iu.test(sha))
    throw new Error(`${errorPrefix}_commit_invalid_response`);
  return sha.toLowerCase();
}

/** Verify the Git object hash over the decoded UTF-8 source, including its byte length. */
export function readGitHubVerifiedWorkflowBlob(
  data: unknown,
  options: {
    readonly errorPrefix: WorkflowSourceErrorPrefix;
    readonly expectedPath?: string;
  },
) {
  const blob = data as {
    type?: unknown;
    path?: unknown;
    encoding?: unknown;
    content?: unknown;
    sha?: unknown;
  } | null;
  if (
    blob?.type !== "file" ||
    (options.expectedPath !== undefined &&
      blob.path !== options.expectedPath) ||
    blob.encoding !== "base64" ||
    typeof blob.content !== "string" ||
    typeof blob.sha !== "string" ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(blob.sha)
  ) {
    throw new Error(`${options.errorPrefix}_content_invalid_response`);
  }
  const source = Buffer.from(
    blob.content.replace(/\s+/gu, ""),
    "base64",
  ).toString("utf8");
  const blobSha = blob.sha.toLowerCase();
  const computed = createHash(blobSha.length === 40 ? "sha1" : "sha256")
    .update(`blob ${Buffer.byteLength(source, "utf8")}\0`, "utf8")
    .update(source, "utf8")
    .digest("hex");
  if (computed !== blobSha)
    throw new Error(`${options.errorPrefix}_blob_sha_mismatch`);
  return { source, blobSha };
}
