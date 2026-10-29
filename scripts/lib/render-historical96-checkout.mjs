import { createHash } from "node:crypto";
import { readRenderManagedCheckoutInventory } from "./render-schema-handoff-policy.mjs";

// Historical execution consumes exactly this manifest. Checkout-only additions
// remain subject to complete source admission before this boundary is applied.
const historical96Manifest =
  "sha256:5faad7059a2f57055086dd1571e87706c261a486e8952334401f1d91cc41c97b";
const checkoutOnlyMigrations = Object.freeze([
  "000098_certified_fork_effect_archive",
  "000099_certified_fork_proof_facts",
  "000100_hosted_codex_device_login",
  "000101_sdk_growth_authority",
  "000102_sdk_growth_current_authority",
  "000103_sdk_growth_authority_custody",
  "000104_hosted_pool_request_scoped_failover",
  "000105_sdk_growth_publication_effect",
  "000106_sdk_growth_finalized_report_logical_identity",
  "000107_hosted_v4_relay_turn_contract",
  "000108_sdk_growth_verifier_assignment",
  "000109_sdk_growth_verifier_assignment_lock",
  "000110_historical_unknown_scope_barrier",
  "000110_provider_api_key_workspace_management",
  "000111_sdk_growth_source_binding",
  "000112_sdk_growth_operator_credential",
  "000113_sdk_growth_approval_ledger",
  "000114_sdk_growth_v3_tool_artifact",
  "000115_sdk_growth_v3_approved_manifest",
  "000116_hosted_codex_relay_admission_utc",
  "000117_provider_accounts",
  "000118_workspace_binding_fences",
  "000119_review_configuration_gateway_binding",
  "000120_review_run_runtime_snapshot",
  "000121_review_run_gateway_execution_binding",
  "000122_review_configuration_operation_receipt",
  "000123_personal_workspace_identity",
  "000124_personal_account_operations",
  "000125_hosted_codex_device_reconnect",
  "000126_review_configuration_mimo_auth_kind",
  "000127_owner_workspace_deletion",
  "000128_account_admission_row_lock",
  "000129_personal_run_snapshot_v2",
  "000130_personal_canonical_operations",
  "000131_personal_canonical_unentered_claim",
  "000132_review_policy_schema_v3",
  "000133_allow_first_time_scm_identity_bind",
  "000134_account_lifecycle",
  "000134_review_provider_kind_v2_ocr",
  "000135_review_run_checkout_repository_lock",
  "000136_provider_usage",
  "000136_review_skills",
  "000137_review_skills_capture",
  "000138_pr_description",
  "000139_review_context_tools",
  "000140_personal_oauth_method",
  "000141_memory_search_projections",
  "000142_memory_knowledge_authority",
  "000142_optional_gateway_reasoning",
  "000143_memory_maintenance_fence",
  "000143_workspace_draft_review_setting",
  "000144_review_statistics",
  "000145_workspace_provider_profiles",
  "000146_drop_review_configuration_projection",
  "000147_review_skills_mutation_identity",
  "000148_lifecycle_verification",
  "000149_api_key_repository_secret_profiles",
  "000150_skills_catalog_security",
  "000151_review_history",
  "000152_review_run_gateway_allocations",
]);

/** @returns {ReadonlyArray<Readonly<{migrationName: string, checksum: string}>>} */
export function readRenderHistorical96CheckoutInventory() {
  const checkout = readRenderManagedCheckoutInventory();
  if (
    checkout.some(
      (row, index) =>
        index > 0 && row.migrationName <= checkout[index - 1].migrationName,
    )
  )
    throw new Error("render_historical96_checkout_rejected:order");
  if (
    ![
      96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110,
      111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125,
      126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140,
      141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155,
    ].includes(
      checkout.filter(
        (row) =>
          row.migrationName !== "000110_provider_api_key_workspace_management",
      ).length,
    )
  )
    throw new Error("render_historical96_checkout_rejected:count");
  const historical = checkout.filter(
    (row) => !checkoutOnlyMigrations.includes(row.migrationName),
  );
  const manifest = `sha256:${createHash("sha256")
    .update(
      historical.map((row) => `${row.migrationName}:${row.checksum}`).join(","),
    )
    .digest("hex")}`;
  if (historical.length !== 96 || manifest !== historical96Manifest)
    throw new Error("render_historical96_checkout_rejected:manifest");
  return Object.freeze(historical);
}
