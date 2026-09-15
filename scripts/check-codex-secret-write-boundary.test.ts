import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkCodexSecretWriteBoundary } from "./check-codex-secret-write-boundary.mjs";

describe("Codex rotating secret write boundary", () => {
  it("accepts the checked-in audited adapters", () => {
    expect(checkCodexSecretWriteBoundary()).toMatchObject({ status: "pass" });
  });

  it("accepts hardened flags on continued reseed curl commands", () => {
    const source = readFileSync(
      join(process.cwd(), "scripts/reseed-codex-rotating-auth.sh"),
      "utf8",
    );
    expect(source).toContain("curl -q --fail-with-body");
    expect(source).toContain("--max-redirs 0");
    expect(checkCodexSecretWriteBoundary()).toMatchObject({ status: "pass" });
  });

  it("rejects a direct Octokit writer, unsupported retry knob, or V namespace", () => {
    const root = mkdtempSync(join(tmpdir(), "rr-write-boundary-"));
    mkdirSync(join(root, "apps/rogue"), { recursive: true });
    writeFileSync(
      join(root, "apps/rogue/write.ts"),
      "GH_HTTP_RETRY_MAX=0; REVIEWROUTER_CODEX_AUTH_JSON_V1_; createOrUpdateRepoSecret();",
    );
    expect(() => checkCodexSecretWriteBoundary(root)).toThrow(
      "direct Octokit secret PUT",
    );
  });

  it.each([
    [
      "second rotating gh provider writer",
      "scripts/seed-codex-rotating-auth.sh",
      "gh secret set FIRST --no-store\ngh secret set SECOND --no-store",
    ],
    [
      "direct provider PUT",
      "apps/rogue/write.ts",
      'request("PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}")',
    ],
    [
      "constructed provider endpoint in mts",
      "scripts/rogue-write.mts",
      'fetch(["https://api.github.com", "repos", owner, repo, "actions", "secrets", name].join("/"), { method: "PUT" })',
    ],
    [
      "constructed method and endpoint in cts",
      "apps/rogue/write.cts",
      'fetch(["repos", owner, repo, "actions", "secrets", name].join("/"), { method: ["P", "UT"].join("") })',
    ],
    [
      "workflow provider writer",
      ".github/actions/rogue/action.yml",
      'runs: { using: node20, main: writer.cjs } # method: "PUT" /repos/x/y/actions/secrets/name',
    ],
    [
      "ungated legacy seed",
      "scripts/seed-codex-auth.sh",
      "main() { gh secret set CODEX_AUTH_JSON; }",
    ],
  ])("rejects mutation: %s", (_, relativePath, source) => {
    const root = mkdtempSync(join(tmpdir(), "rr-write-boundary-mutation-"));
    const file = join(root, relativePath);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, source);
    expect(() => checkCodexSecretWriteBoundary(root)).toThrow();
  });

  it.each([
    [
      "encrypted payload omission",
      "encryptedValue:provider.encrypted_value",
      "encryptedPayload:provider.encrypted_value",
    ],
    ["key id omission", "keyId:provider.key_id", "providerKey:provider.key_id"],
    [
      "ledger curl without first-argument -q",
      "curl -q -fsS --max-redirs 0",
      "curl -fsS --max-redirs 0",
    ],
    [
      "ledger redirect following",
      "curl -q -fsS --max-redirs 0",
      "curl -q -fsSL --max-redirs 0",
    ],
    [
      "ledger redirect cap removal",
      "curl -q -fsS --max-redirs 0",
      "curl -q -fsS",
    ],
    [
      "ledger URL validation removal",
      "  validate_versioned_ledger_urls\n}",
      "}",
    ],
  ])("rejects rotating installer boundary mutation: %s", (_, from, to) => {
    const root = mkdtempSync(join(tmpdir(), "rr-write-boundary-installer-"));
    const target = join(root, "scripts/seed-codex-rotating-auth.sh");
    mkdirSync(join(target, ".."), { recursive: true });
    const source = readFileSync(
      join(process.cwd(), "scripts/seed-codex-rotating-auth.sh"),
      "utf8",
    );
    expect(source).toContain(from);
    writeFileSync(target, source.replace(from, to));

    expect(() => checkCodexSecretWriteBoundary(root)).toThrow(
      "rotating write is not the pinned one-shot adapter",
    );
  });
});
