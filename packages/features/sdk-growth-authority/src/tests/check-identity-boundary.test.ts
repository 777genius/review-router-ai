import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("SDK growth reservation ownership", () => {
  it("keeps generic SCM exports and publishers free of feature policy", () => {
    for (const path of [
      "packages/shared/src/scm/index.ts",
      "apps/worker/src/review-v2-publication-gateways.ts",
      "apps/api/src/github/octokit-conflict-review-posting-gateway.ts",
    ]) {
      expect(source(path)).not.toMatch(
        /sdk.growth|SDK_GROWTH|assertUnreservedCheckIdentity|reserved-check-identity/i,
      );
    }
  });

  it("wires the owning feature policy into both production publishers", () => {
    const api = source("apps/api/src/app.ts");
    const worker = source("apps/worker/src/review-v2-production-runtime.ts");
    for (const composition of [api, worker]) {
      expect(composition).toMatch(
        /import \{ assertUnreservedCheckIdentity \} from "@reviewrouter\/features-sdk-growth-authority"/,
      );
    }
    expect(api).toMatch(
      /new OctokitConflictReviewPostingGateway\(\{\s*assertCheckIdentityAllowed:/,
    );
    expect(worker).toMatch(
      /new GitHubAppReviewV2CredentialProvider\([\s\S]*?projections,\s*assertUnreservedCheckIdentity,/,
    );
    const provider = source(
      "apps/worker/src/review-v2-publication-gateways.ts",
    );
    expect(provider).toContain(
      "assertCheckIdentityAllowed: this.assertCheckIdentityAllowed",
    );
  });
});
