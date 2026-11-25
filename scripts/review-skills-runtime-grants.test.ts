import { describe, expect, it } from "vitest";
import {
  runtimeGrantStatements,
  runtimeAclGateStatements,
} from "./run-codex-rotating-release-migration.mjs";
import { reviewSkillsRuntimeGrantStatements } from "./review-skills-runtime-grants.js";

describe("Review Skills canonical runtime ACL projection", () => {
  it("runs after the legacy broad grant and function reset for every runtime principal", () => {
    const sql = runtimeGrantStatements({
      roles: [
        { role: "web", username: "reviewrouter_web" },
        { role: "api", username: "reviewrouter_api" },
        { role: "worker", username: "reviewrouter_worker" },
        {
          role: "comment-token-custody",
          username: "reviewrouter_comment_token_custody",
        },
        {
          role: "effect-authority",
          username: "reviewrouter_codex_effect_authority",
        },
      ],
    });
    expect(sql.indexOf("DO $review_skills_runtime_acl$")).toBeGreaterThan(
      sql.lastIndexOf(
        "REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;",
      ),
    );
    expect(sql.match(/DO \$review_skills_runtime_acl\$/g)).toHaveLength(5);
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.rr_review_skills_repository_lock(text,text[]) TO %I', 'reviewrouter_web'",
    );
    expect(sql).not.toContain(
      "GRANT EXECUTE ON FUNCTION public.rr_review_skills_repository_lock(text,text[]) TO %I', 'reviewrouter_api'",
    );
    expect(sql).toContain("review skills runtime effective ACL incompatible");
    expect(sql).toContain("REVOKE ALL (%I) ON TABLE public.%I FROM PUBLIC, %I");
  });
  it("rejects SQL fragments as principal identifiers", () => {
    expect(() =>
      reviewSkillsRuntimeGrantStatements([
        { role: "web", username: "web;GRANT ALL" },
      ]),
    ).toThrow("review_skills_runtime_role_invalid");
  });
  it("removes Skills column writes after closing the existing table-write gate", () => {
    const sql = runtimeAclGateStatements({
      roles: [{ username: "reviewrouter_web", role: "web" }],
    });
    expect(sql.indexOf("DO $review_skills_runtime_gate_acl$")).toBeGreaterThan(
      sql.indexOf("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES"),
    );
    expect(sql).toContain("REVOKE ALL (%I) ON TABLE public.%I FROM %I");
  });
});
