import { describe, expect, it } from "vitest";
import {
  partitionRenderSchemaHandoffCheckout,
  readRenderManagedCheckoutInventory,
} from "./render-schema-handoff-policy.mjs";
import { readRenderHistorical96CheckoutInventory } from "./render-historical96-checkout.mjs";

const keyName = "000110_provider_api_key_workspace_management";
const predecessor = "000109_sdk_growth_verifier_assignment_lock";
// Isolate the original key addition against the frozen pre-MiMO source catalog.
const originalHistory = readRenderManagedCheckoutInventory()
  .filter(
    (row) =>
      row.migrationName !== keyName &&
      row.migrationName !== "000126_review_configuration_mimo_auth_kind" &&
      row.migrationName !== "000127_owner_workspace_deletion" &&
      row.migrationName !== "000128_account_admission_row_lock" &&
      row.migrationName !== "000129_personal_run_snapshot_v2" &&
      row.migrationName !== "000130_personal_canonical_operations" &&
      row.migrationName !== "000131_personal_canonical_unentered_claim" &&
      row.migrationName !== "000132_review_policy_schema_v3" &&
      row.migrationName !== "000134_account_lifecycle" &&
      row.migrationName !== "000134_review_provider_kind_v2_ocr" &&
      row.migrationName !== "000136_provider_usage" &&
      row.migrationName !== "000135_review_run_checkout_repository_lock" &&
      row.migrationName !== "000136_review_skills" &&
      row.migrationName !== "000137_review_skills_capture" &&
      row.migrationName !== "000138_pr_description" &&
      row.migrationName !== "000139_review_context_tools" &&
      row.migrationName !== "000140_personal_oauth_method" &&
      row.migrationName !== "000141_memory_search_projections" &&
      row.migrationName !== "000142_optional_gateway_reasoning" &&
      row.migrationName !== "000144_review_statistics" &&
      row.migrationName !== "000143_workspace_draft_review_setting" &&
      row.migrationName !== "000145_workspace_provider_profiles" &&
      row.migrationName !== "000149_api_key_repository_secret_profiles" &&
      row.migrationName !== "000142_memory_knowledge_authority" &&
      row.migrationName !== "000143_memory_maintenance_fence" &&
      row.migrationName !== "000148_lifecycle_verification" &&
      row.migrationName !== "000147_review_skills_mutation_identity" &&
      row.migrationName !== "000146_drop_review_configuration_projection" &&
      row.migrationName !== "000133_allow_first_time_scm_identity_bind",
  )
  .map((row) =>
    row.migrationName === "000119_review_configuration_gateway_binding"
      ? {
          ...row,
          checksum:
            "2c0dde1720111063059d5226c6011c15389b6877a6a1f924177a24a36aa81a70",
        }
      : row,
  );
const key = {
  migrationName: keyName,
  checksum: "d69beaa182fd49ad231bb86b2af4b9d53af3c54cab3a12fa3ca910e7a4379208",
};
const withKey = (rows: typeof originalHistory) =>
  [...rows, key].sort((a, b) => a.migrationName.localeCompare(b.migrationName));

describe("provider key checkout admission preserves historical authority", () => {
  it("admits the exact key addition without enlarging managed92 or historical96", () => {
    const combined = withKey(originalHistory);
    expect(partitionRenderSchemaHandoffCheckout(combined)).toEqual(
      partitionRenderSchemaHandoffCheckout(originalHistory),
    );
    expect(partitionRenderSchemaHandoffCheckout(combined)).toHaveLength(92);
    expect(readRenderHistorical96CheckoutInventory()).toHaveLength(96);
    expect(combined).toHaveLength(originalHistory.length + 1);
  });

  it("also validates the exact predecessor checkout with the key addition", () => {
    const prefix = originalHistory.filter(
      (row) => row.migrationName <= predecessor,
    );
    expect(partitionRenderSchemaHandoffCheckout(withKey(prefix))).toEqual(
      partitionRenderSchemaHandoffCheckout(prefix),
    );
  });

  it.each([
    [
      "wrong key checksum",
      () =>
        withKey(originalHistory).map((row) =>
          row.migrationName === keyName
            ? { ...row, checksum: "0".repeat(64) }
            : row,
        ),
    ],
    [
      "missing predecessor",
      () =>
        withKey(
          originalHistory.filter((row) => row.migrationName !== predecessor),
        ),
    ],
    ["duplicate key", () => withKey([...originalHistory, key])],
    [
      "changed original checksum",
      () =>
        withKey(
          originalHistory.map((row) =>
            row.migrationName === predecessor
              ? { ...row, checksum: "0".repeat(64) }
              : row,
          ),
        ),
    ],
    [
      "missing original middle migration",
      () =>
        withKey(
          originalHistory.filter(
            (row) =>
              row.migrationName !== "000108_sdk_growth_verifier_assignment",
          ),
        ),
    ],
    [
      "unknown future migration",
      () =>
        withKey([
          ...originalHistory,
          {
            migrationName: "000999_unreviewed_checkout",
            checksum: "0".repeat(64),
          },
        ]),
    ],
  ] as const)("rejects %s", (_label, rows) => {
    expect(() => partitionRenderSchemaHandoffCheckout(rows())).toThrow();
  });
});
