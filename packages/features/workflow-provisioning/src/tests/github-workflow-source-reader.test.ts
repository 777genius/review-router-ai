import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  readGitHubVerifiedWorkflowBlob,
  readGitHubWorkflowCommitSha,
  readGitHubWorkflowRepositoryIdentity,
} from "../infrastructure/github/github-workflow-source-reader";

const source = "name: Vérification\non: push\n";
const path = ".github/workflows/reviewrouter-codex.yml";
function response(algorithm: "sha1" | "sha256" = "sha1") {
  const sha = createHash(algorithm)
    .update(`blob ${Buffer.byteLength(source, "utf8")}\0`)
    .update(source)
    .digest("hex");
  return {
    type: "file",
    path,
    encoding: "base64",
    content: `${Buffer.from(source).toString("base64")}\n`,
    sha,
  };
}

describe.each(["codex_rotating_workflow", "hosted_workflow"] as const)(
  "%s verified workflow source",
  (errorPrefix) => {
    it.each(["sha1", "sha256"] as const)(
      "verifies exact UTF-8 Git blob bytes with %s",
      (algorithm) => {
        const blob = response(algorithm);
        expect(
          readGitHubVerifiedWorkflowBlob(
            { ...blob, sha: blob.sha.toUpperCase() },
            { errorPrefix, expectedPath: path },
          ),
        ).toEqual({ source, blobSha: blob.sha });
      },
    );

    it("refuses valid content from the wrong path", () => {
      expect(() =>
        readGitHubVerifiedWorkflowBlob(response(), {
          errorPrefix,
          expectedPath: ".github/workflows/other.yml",
        }),
      ).toThrow(`${errorPrefix}_content_invalid_response`);
    });

    it("rejects altered decoded content and malformed provider envelopes", () => {
      expect(() =>
        readGitHubVerifiedWorkflowBlob(
          {
            ...response(),
            content: Buffer.from(`${source}# altered`).toString("base64"),
          },
          { errorPrefix },
        ),
      ).toThrow(`${errorPrefix}_blob_sha_mismatch`);
      for (const patch of [
        { type: "directory" },
        { encoding: "utf8" },
        { content: null },
        { sha: "not-a-git-object" },
      ]) {
        expect(() =>
          readGitHubVerifiedWorkflowBlob(
            { ...response(), ...patch },
            { errorPrefix },
          ),
        ).toThrow(`${errorPrefix}_content_invalid_response`);
      }
    });

    it("retains exact immutable identity and commit requirements", () => {
      expect(
        readGitHubWorkflowRepositoryIdentity(
          { id: 456, full_name: "Acme/Widget", default_branch: "main" },
          errorPrefix,
        ),
      ).toEqual({ id: "456", fullName: "Acme/Widget", defaultBranch: "main" });
      expect(
        readGitHubWorkflowCommitSha(
          { object: { sha: "A".repeat(40) } },
          errorPrefix,
        ),
      ).toBe("a".repeat(40));
      for (const id of ["456", 0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() =>
          readGitHubWorkflowRepositoryIdentity(
            { id, full_name: "Acme/Widget", default_branch: "main" },
            errorPrefix,
          ),
        ).toThrow(`${errorPrefix}_repository_invalid_response`);
      }
      expect(() =>
        readGitHubWorkflowCommitSha(
          { object: { sha: "a".repeat(64) } },
          errorPrefix,
        ),
      ).toThrow(`${errorPrefix}_commit_invalid_response`);
    });
  },
);
