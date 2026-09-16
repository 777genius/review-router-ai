import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

import type { CertifiedForkReviewBinding } from "../../../action-control-plane/src/application/ports/certified-fork-review-port.js";
import { parseCertifiedForkReviewBinding } from "../../../action-control-plane/src/application/use-cases/certified-fork-review-binding.js";

export const certifiedForkActionMode = "fork_prompt_only_v2";
export const certifiedForkAdmissionUnavailable =
  "certified-fork-admission-unavailable: certified fork admission unavailable; no review performed";
export const certifiedForkEventMaxBytes = 1024 * 1024;

function unavailable(): never {
  throw new Error(certifiedForkAdmissionUnavailable);
}

export function assertCertifiedForkModeSchema(env: NodeJS.ProcessEnv): void {
  if (
    env.INPUT_MODE !== certifiedForkActionMode ||
    (env["INPUT_WORKFLOW-SCHEMA-VERSION"] ??
      env.INPUT_WORKFLOW_SCHEMA_VERSION) !== "6" ||
    (env["INPUT_WORKFLOW-SCHEMA-VERSION"] !== undefined &&
      env.INPUT_WORKFLOW_SCHEMA_VERSION !== undefined &&
      env["INPUT_WORKFLOW-SCHEMA-VERSION"] !==
        env.INPUT_WORKFLOW_SCHEMA_VERSION)
  )
    unavailable();
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    unavailable();
  }
  return value as Record<string, unknown>;
}

function positiveId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    unavailable();
  }
  return value;
}

function repository(value: unknown) {
  const repo = record(value);
  if (
    typeof repo.full_name !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/.test(
      repo.full_name,
    ) ||
    [".", ".."].includes(repo.full_name.split("/")[1]!) ||
    repo.private !== false
  ) {
    unavailable();
  }
  return { name: repo.full_name, id: positiveId(repo.id), fork: repo.fork };
}

/** Only designated event bytes and GitHub identity supply the binding. No caller binding. */
export function readCertifiedForkInvocation(
  eventJson: string,
  env: NodeJS.ProcessEnv,
): CertifiedForkReviewBinding {
  try {
    assertCertifiedForkModeSchema(env);
    if (
      env.GITHUB_EVENT_NAME !== "pull_request_target" ||
      Buffer.byteLength(eventJson, "utf8") > certifiedForkEventMaxBytes
    )
      unavailable();
    const event = record(JSON.parse(eventJson));
    if (
      typeof event.action !== "string" ||
      !["opened", "reopened", "synchronize", "ready_for_review"].includes(
        event.action,
      )
    ) {
      unavailable();
    }
    const pr = record(event.pull_request);
    if (pr.draft !== false || pr.state !== "open") unavailable();
    const base = record(pr.base);
    const head = record(pr.head);
    const baseRepo = repository(base.repo);
    const headRepo = repository(head.repo);
    const eventRepo = repository(event.repository);
    if (
      headRepo.fork !== true ||
      headRepo.id === baseRepo.id ||
      headRepo.name.toLowerCase() === baseRepo.name.toLowerCase() ||
      baseRepo.name !== eventRepo.name ||
      baseRepo.id !== eventRepo.id ||
      baseRepo.name !== env.GITHUB_REPOSITORY ||
      String(baseRepo.id) !== env.GITHUB_REPOSITORY_ID ||
      positiveId(event.number) !== positiveId(pr.number) ||
      head.sha === pr.merge_commit_sha ||
      base.sha === pr.merge_commit_sha
    ) {
      unavailable();
    }
    // The shared parser validates full immutable SHAs and freezes a detached copy.
    return parseCertifiedForkReviewBinding({
      sourceRepository: headRepo.name,
      sourceRepositoryId: String(headRepo.id),
      baseRepository: baseRepo.name,
      baseRepositoryId: String(baseRepo.id),
      pullRequestNumber: positiveId(pr.number),
      reviewHeadSha: head.sha,
      baseSha: base.sha,
      trustDomain: "fork",
    });
  } catch {
    unavailable();
  }
}

/** Synchronous bounded input capture: no async gap, workspace read, or authority adapter. */
export function runCertifiedForkAdmissionBoundary(
  env: NodeJS.ProcessEnv,
): never {
  let fd: number | undefined;
  try {
    // Check dispatch before opening even the designated event file.
    assertCertifiedForkModeSchema(env);
    if (
      env.GITHUB_EVENT_NAME !== "pull_request_target" ||
      !env.GITHUB_EVENT_PATH
    )
      unavailable();
    fd = openSync(
      env.GITHUB_EVENT_PATH,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > certifiedForkEventMaxBytes) unavailable();
    const bytes = Buffer.alloc(certifiedForkEventMaxBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > certifiedForkEventMaxBytes) unavailable();
    readCertifiedForkInvocation(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, length),
      ),
      env,
    );
  } catch {
    unavailable();
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        unavailable();
      }
    }
  }
  // No server-owned admission/lease bridge exists. Never enter the ordinary runtime.
  unavailable();
}
