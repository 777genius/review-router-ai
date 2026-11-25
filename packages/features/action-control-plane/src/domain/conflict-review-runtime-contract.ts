import {
  safeConflictReviewDispatchId,
  safeGitHubBranchName,
} from "@reviewrouter/shared";
import { z } from "zod";

export const conflictReviewRuntimeProtocolVersion = 1;
export const conflictReviewRuntimeDiffMaxFiles = 100;
export const conflictReviewRuntimeDiffMaxBytes = 256 * 1024;
export const conflictReviewRuntimeDiffMaxPatchBytesPerFile = 48 * 1024;
export const conflictReviewAdvisoryStatusContext =
  "ReviewRouter conflict review";
export const conflictReviewPostingSessionPath =
  "/api/action/v1/conflict-posting/session";
export const conflictReviewPostingSummaryPath =
  "/api/action/v1/conflict-posting/summary";
export const conflictReviewPostingStatusPath =
  "/api/action/v1/conflict-posting/status";
export const conflictReviewSummaryMaxBytes = 60_000;

const shaSchema = z.string().regex(/^[a-fA-F0-9]{40}$/);

export const actionConflictReviewRuntimeConfigSchema = z
  .object({
    protocolVersion: z.literal(conflictReviewRuntimeProtocolVersion),
    reviewKind: z.literal("conflict-head"),
    dispatchId: safeConflictReviewDispatchId,
    pullRequestNumber: z.number().int().positive(),
    headSha: shaSchema,
    baseRef: safeGitHubBranchName,
    baseSha: shaSchema,
    checkout: z
      .object({
        mode: z.literal("exact_head_sha"),
        headSha: shaSchema,
        baseRef: safeGitHubBranchName,
        baseSha: shaSchema,
        persistCredentials: z.literal(false),
      })
      .strict(),
    diff: z
      .object({
        mode: z.literal("expected_base_to_head"),
        baseSha: shaSchema,
        headSha: shaSchema,
        maxFiles: z.number().int().positive(),
        maxBytes: z.number().int().positive(),
        maxPatchBytesPerFile: z.number().int().positive(),
      })
      .strict(),
    posting: z.discriminatedUnion("mode", [
      z
        .object({
          mode: z.literal("disabled"),
          reason: z.literal("posting_proxy_not_enabled"),
        })
        .strict(),
      z
        .object({
          mode: z.literal("proxy"),
          sessionEndpoint: z.literal(conflictReviewPostingSessionPath),
          summaryEndpoint: z.literal(conflictReviewPostingSummaryPath),
          statusEndpoint: z.literal(conflictReviewPostingStatusPath),
          allowedOperations: z.tuple([
            z.literal("summary_comment"),
            z.literal("advisory_status"),
          ]),
          summaryMaxBytes: z.literal(conflictReviewSummaryMaxBytes),
          statusContext: z.literal(conflictReviewAdvisoryStatusContext),
        })
        .strict(),
    ]),
  })
  .strict();

export type ActionConflictReviewRuntimeConfig = z.infer<
  typeof actionConflictReviewRuntimeConfigSchema
>;
