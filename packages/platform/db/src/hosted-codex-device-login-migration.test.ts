import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("000100 hosted Codex dashboard device login", () => {
  const sql = readFileSync(
    resolve(
      import.meta.dirname,
      "../prisma/migrations/000100_hosted_codex_device_login/migration.sql",
    ),
    "utf8",
  );
  const schema = readFileSync(
    resolve(import.meta.dirname, "../prisma/schema.prisma"),
    "utf8",
  );

  it("adds a workspace-bound in-flight table without token columns", () => {
    expect(sql).toContain("SET LOCAL lock_timeout = '15s';");
    expect(sql).toContain("SET LOCAL statement_timeout = '5min';");
    expect(sql).toContain('CREATE TABLE "HostedCodexDeviceLogin"');
    expect(schema).toContain("model HostedCodexDeviceLogin {");
    expect(schema).toContain(
      "hostedCodexDeviceLogins      HostedCodexDeviceLogin[]",
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "HostedCodexDeviceLogin_one_pending_per_workspace_key"',
    );
    expect(sql).toContain("WHERE \"status\" = 'pending'");
    expect(sql).toContain("ON DELETE RESTRICT");
    expect(sql).not.toMatch(/ON DELETE CASCADE/u);
    expect(sql).not.toMatch(/refresh_token|access_token|id_token|authJson/iu);
    expect(schema).not.toMatch(
      /^\s*(?:refreshToken|accessToken|idToken|authJson)\s/mu,
    );
  });

  it("wipes deviceAuthId on any terminal status", () => {
    expect(sql).toContain("HostedCodexDeviceLogin_device_auth_lifecycle_check");
    expect(sql).toContain("\"status\" = 'pending'");
    expect(sql).toContain('"deviceAuthId" IS NOT NULL');
    expect(sql).toContain('AND "deviceAuthId" IS NULL');
  });
});
