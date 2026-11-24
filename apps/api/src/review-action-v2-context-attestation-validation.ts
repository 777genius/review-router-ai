// Map context manifest and request validation failures to the existing route contract.
import {
  canonicalContextAttestationManifest,
  createContextAttestationManifest,
  isContextGatewayV4ValidationIssue,
  type ContextAttestationManifest,
} from "@reviewrouter/features-review-context-attestation";
import { ReviewActionV2RouteFailure } from "@reviewrouter/features-action-control-plane/v2";
import { ReviewActionV2ProtocolErrorCode } from "@reviewrouter/protocol-review-action-v2";
import type { ReviewActionV2ContextDigestPort } from "./review-action-v2-context-attestation-types.js";

export function parseContextManifest(value: string, issue: string) {
  let manifest: ContextAttestationManifest;
  try {
    manifest = createContextAttestationManifest(JSON.parse(value));
  } catch (error) {
    throw failure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      compactIssues([issue, safeContextManifestIssue(error)]),
    );
  }
  if (canonicalContextAttestationManifest(manifest) !== value) {
    throw failure(
      400,
      ReviewActionV2ProtocolErrorCode.InvalidRequest,
      `${issue}_not_canonical`,
    );
  }
  return manifest;
}

export async function requireHash(
  canonicalValue: string,
  expected: string,
  issue: string,
  digest: ReviewActionV2ContextDigestPort,
) {
  requireEqual(await digest.digestUtf8(canonicalValue), expected, issue);
}

export function requireEqual(
  actual: unknown,
  expected: unknown,
  issue: string,
): void {
  if (actual !== expected) {
    throw failure(
      412,
      ReviewActionV2ProtocolErrorCode.StalePrecondition,
      issue,
    );
  }
}

export function requiredString(
  value: string | undefined,
  issue: string,
): string {
  if (!value) {
    throw failure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      issue,
    );
  }
  return value;
}

export function failure(
  statusCode: 400 | 401 | 403 | 404 | 410 | 412 | 422,
  code: ReviewActionV2ProtocolErrorCode,
  issue: string | readonly string[],
) {
  return new ReviewActionV2RouteFailure(
    statusCode,
    code,
    typeof issue === "string" ? [issue] : [...issue],
  );
}

function compactIssues(
  issues: readonly (string | null | undefined)[],
): readonly string[] {
  return issues.filter((issue): issue is string => Boolean(issue));
}

function safeContextManifestIssue(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const message = error.message;
  if (isContextGatewayV4ValidationIssue(message)) return message;
  if (
    /^(?:context_dependency|context_git|text_search|file_read|directory|git_fact|gateway|checkout_tree|authenticated_event_chain|previous_event|event)_[a-z0-9_]+$/.test(
      message,
    )
  ) {
    return message;
  }
  return null;
}
