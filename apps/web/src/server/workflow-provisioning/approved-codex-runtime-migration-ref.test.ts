import { describe, expect, it } from "vitest";
import { assertCodexRuntimeMigrationTargetWorkflow } from "./approved-codex-runtime-migration-ref";

const source = `# ReviewRouter credential-preserving runtime migration v1
on:
  workflow_call:
    inputs:
      migration_id: { type: string, required: true }
      provider_instance_id: { type: string, required: true }
      setup_base_url: { type: string, required: true }
      source_namespace_id: { type: string, required: true }
      source_namespace_epoch: { type: string, required: true }
    secrets:
      codex_auth_json: { required: true }
`;
describe("registered target migration entrypoint contract", () => {
  it("accepts only the finite runner interface", () => {
    expect(() =>
      assertCodexRuntimeMigrationTargetWorkflow(source),
    ).not.toThrow();
  });
  it.each([
    source.replace("migration_id:", "setup_nonce:"),
    source.replace(
      "source_namespace_epoch: { type: string, required: true }",
      "source_namespace_epoch: { type: string, required: false }",
    ),
    source.replace("codex_auth_json:", "app_write_token:"),
    source.replace(
      "# ReviewRouter credential-preserving runtime migration v1",
      "# unknown",
    ),
    source.replace("  workflow_call:", "  push: {}\n  workflow_call:"),
  ])("rejects incomplete or widened contracts", (invalid) => {
    expect(() => assertCodexRuntimeMigrationTargetWorkflow(invalid)).toThrow();
  });
});
