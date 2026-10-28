import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";

// Source and ledger evidence only. These invariants do not authorize a managed
// production baseline, database identity, workflow execution, or runtime entry.
export const renderSchemaHandoffMigrationContract = Object.freeze({
  sourceCommit: "42134d9b8c263915340f910786b6826824bf30b5",
  sourceTree: "23bfcc8d4ce60bbdccf132a0fdd2498d18f62829",
  baselineCount: 89,
  targetCount: 92,
  baselineManifest:
    "sha256:13acb121fbc5bbdebef197d58d5e8dcfca99815e005acc0aae7988bc86d33ef2",
  targetManifest:
    "sha256:7e53c8fe3c84c3979b6e8c6b1b8f5ded6734f2f053f0a17ae03a468a5939c063",
  pending: Object.freeze([
    Object.freeze({
      migrationName: "000087_codex_oauth_v4_v5_workflow_reattestation",
      checksum:
        "af5fccfd987312b85d48cd38b7f528780f52e82daab47c34829581e50193b090",
    }),
    Object.freeze({
      migrationName: "000088_codex_oauth_reattestation_mutation_owner_fence",
      checksum:
        "18a1e48953d1360d3661ea6753b7aa350fc7e28caeaeb65d42c9ac42569f1cf0",
    }),
    Object.freeze({
      migrationName: "000089_codex_oauth_v4_v5_staged_compatibility",
      checksum:
        "bd35157bc11c84dd181ba7f2edf589503d75cb359c12e9a93bf4a884f94c9db7",
    }),
  ]),
});

const fail = (reason) => {
  throw new Error(`render_schema_handoff_rejected:${reason}`);
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const manifest = (rows) =>
  `sha256:${sha256(rows.map((r) => `${r.migrationName}:${r.checksum}`).join(","))}`;

// The two 76-row catalogs are different histories. Only the source prefix
// through 000074 is admitted here; the private-PG17 baseline remains separate.
export const renderManagedMigrationPhases = Object.freeze({
  "managed-retained-upgrade": Object.freeze({
    baselineCount: 76,
    targetCount: 89,
    baselineManifest:
      "sha256:fb3e60a451ece179a3f0c44748f8500ac51ea5dcf186b0732463db4098de94b8",
    targetManifest: renderSchemaHandoffMigrationContract.baselineManifest,
    atomic: false,
  }),
  "managed-schema-handoff": Object.freeze({
    baselineCount: 89,
    targetCount: 92,
    baselineManifest: renderSchemaHandoffMigrationContract.baselineManifest,
    targetManifest: renderSchemaHandoffMigrationContract.targetManifest,
    atomic: true,
  }),
});

export function renderManagedMigrationPhase(phase) {
  if (!Object.hasOwn(renderManagedMigrationPhases, phase))
    fail("managed_phase");
  return renderManagedMigrationPhases[phase];
}

export function assertRenderSchemaHandoffCatalog(catalog) {
  const contract = renderSchemaHandoffMigrationContract;
  if (
    !Array.isArray(catalog) ||
    catalog.length !== contract.targetCount ||
    catalog.some(
      (row, i) =>
        !row ||
        !/^\d{6}_[a-z0-9_]+$/u.test(row.migrationName) ||
        !/^[a-f0-9]{64}$/u.test(row.checksum) ||
        (i > 0 && row.migrationName <= catalog[i - 1].migrationName),
    ) ||
    manifest(catalog) !== contract.targetManifest ||
    manifest(catalog.slice(0, 76)) !==
      renderManagedMigrationPhases["managed-retained-upgrade"]
        .baselineManifest ||
    manifest(catalog.slice(0, contract.baselineCount)) !==
      contract.baselineManifest ||
    catalog
      .slice(contract.baselineCount)
      .some(
        (row, i) =>
          row.migrationName !== contract.pending[i].migrationName ||
          row.checksum !== contract.pending[i].checksum,
      )
  )
    fail("migration_catalog");
}

// Checkout admission only: these PR244 files never enter managed SQL or ledger
// bounds. Full names matter, including the two distinct 000089 directories.
export const renderSchemaHandoffCheckoutExtension = Object.freeze([
  Object.freeze({
    migrationName: "000089_workflow_provisioning_writer_quiescence",
    checksum:
      "92496088bff5e074c19a74a5a9dacdc38cb8794fac0abec605121eb3b61b29f8",
  }),
  Object.freeze({
    migrationName: "000090_workflow_provisioning_attempt_authority",
    checksum:
      "ca3fbbdc19b72ac75c0b31a5ddae887028191ec8c333b769853fc88f2cf37a49",
  }),
  Object.freeze({
    migrationName: "000091_workflow_provisioning_artifact_and_inventory",
    checksum:
      "086a7e2a38e1c3fa67ba44edcdac198af46327fd380eaeb2d13849ac6d22a562",
  }),
]);

// Checkout admission only; post-historical additions remain outside managed repair.
const checkoutExtensions = Object.freeze([
  ...renderSchemaHandoffCheckoutExtension,
  Object.freeze({
    migrationName: "000096_hosted_pool_public_repository_eligibility",
    checksum:
      "d1b49b764f406004227f3af9e23e3a4b36268b73d76f8e7b19828d508d8c8826",
  }),
  Object.freeze({
    migrationName: "000098_certified_fork_effect_archive",
    checksum:
      "b90a4178f923d523ee0580ca3fc12279e6a1830ad54404b06c10e991fc12139f",
  }),
  Object.freeze({
    migrationName: "000099_certified_fork_proof_facts",
    checksum:
      "c40a8c3ccdf14c5f84a79b5310dbf67c9306ac8c0a0cfb4f1090ced4c7c01fbd",
  }),
  Object.freeze({
    migrationName: "000100_hosted_codex_device_login",
    checksum:
      "495fd9321ffb92fc75aa60807ef644bd720778cd2529fb08d2a0a183fc7404b6",
  }),
  Object.freeze({
    migrationName: "000101_sdk_growth_authority",
    checksum:
      "b6c7c4005bf3a521a1cbcf3579197b58c0c56c91056a02d01a17c60eb7bbf1b9",
  }),
  Object.freeze({
    migrationName: "000102_sdk_growth_current_authority",
    checksum:
      "49757aeaab4ad1cf6b54f41b3768f7e4c8cdbd8beba9436ef4a3f4aa4c4e87cc",
  }),
  Object.freeze({
    migrationName: "000103_sdk_growth_authority_custody",
    checksum:
      "d6ae002a076c616d33ce854477096408b37e4285bb1c036dd2be13072786c8f9",
  }),
  Object.freeze({
    migrationName: "000104_hosted_pool_request_scoped_failover",
    checksum:
      "7e63286c8bfab3c1cf7aa559c1515fa39a47ec3f8861eefcbf569a5d462039a7",
  }),
  Object.freeze({
    migrationName: "000105_sdk_growth_publication_effect",
    checksum:
      "d92d4368cc20c5217cdeaf18f1abbeec7c98efd873fc91110c6178eb1739848f",
  }),
  Object.freeze({
    migrationName: "000106_sdk_growth_finalized_report_logical_identity",
    checksum:
      "a47efeb47fcac73f502818fdf959ff86e44c228951b2839a1b694072e98c3f6d",
  }),
  Object.freeze({
    migrationName: "000107_hosted_v4_relay_turn_contract",
    checksum:
      "476184a558e47d23ee4127b7ff2221979b37e81faabf8ad66cba42dfd35aba9b",
  }),
  Object.freeze({
    migrationName: "000108_sdk_growth_verifier_assignment",
    checksum:
      "ad11dc22b7c528e68fa371d5a435d1ae494fc07b517d14822bfe9472df35ff1a",
  }),
  Object.freeze({
    migrationName: "000109_sdk_growth_verifier_assignment_lock",
    checksum:
      "750038a865bced544ae9cca42060112a6479c05163c3dc05c41f504c993147ef",
  }),
  Object.freeze({
    migrationName: "000110_historical_unknown_scope_barrier",
    checksum:
      "aa9cd8a8e34e9909dcc22c5a7dd94cc4121821db93330c0a54bb48b0aaf61a79",
  }),
  Object.freeze({
    migrationName: "000111_sdk_growth_source_binding",
    checksum:
      "2d9b80ff0d894ba22602c4d84f7487a5343352e6bd2602f64c0b3cafdce048cd",
  }),
  Object.freeze({
    migrationName: "000112_sdk_growth_operator_credential",
    checksum:
      "0178f5198025c8e0f03bc995139940f9a2c9739f3c3ad000c857e8e0c8b425d0",
  }),
  Object.freeze({
    migrationName: "000113_sdk_growth_approval_ledger",
    checksum:
      "1684eced3efccf7af153c4fd8e24a31a96aec20ddb2674b2764ba56796d8f6c2",
  }),
  Object.freeze({
    migrationName: "000114_sdk_growth_v3_tool_artifact",
    checksum:
      "14d0dd69bdf596cbdfe39306965b08bd969a9d9b89b0a49ddcfe34fe43118d58",
  }),
  Object.freeze({
    migrationName: "000115_sdk_growth_v3_approved_manifest",
    checksum:
      "07fdc348fe27d0ee1ddc15d97e6932cca3dc02cc920d856c4380f71cabb36db0",
  }),
  Object.freeze({
    migrationName: "000116_hosted_codex_relay_admission_utc",
    checksum:
      "af399b3aea5cd73e0b65a46085bba2df216cd44888caf066baa02a6516f7d585",
  }),
  Object.freeze({
    migrationName: "000117_provider_accounts",
    checksum:
      "786e21fc4a8880c25f41304393a576d8e3337b6654720931aa076fdbf793c4e7",
  }),
  Object.freeze({
    migrationName: "000118_workspace_binding_fences",
    checksum:
      "fe73ffe809b3c49b0739060e853e1a824ea6bf019a9922fccc8b729581db48db",
  }),
  Object.freeze({
    migrationName: "000119_review_configuration_gateway_binding",
    checksum:
      "2c0dde1720111063059d5226c6011c15389b6877a6a1f924177a24a36aa81a70",
  }),
  Object.freeze({
    migrationName: "000120_review_run_runtime_snapshot",
    checksum:
      "6ced2dc41f736a2c6e42d6edafc4e9f753622fa157baff09ea962da9d81bd369",
  }),
  Object.freeze({
    migrationName: "000121_review_run_gateway_execution_binding",
    checksum:
      "c00f5df0b3971477cdf666b3259e173aec2df0d150e3335507617242742967e6",
  }),
  Object.freeze({
    migrationName: "000122_review_configuration_operation_receipt",
    checksum:
      "89f9f4eadeb88733adddb051bca5e50bdc86bbb06e45905d3bdf18eedbd1386e",
  }),
  Object.freeze({
    migrationName: "000123_personal_workspace_identity",
    checksum:
      "b459bbb36015e16656fa20d5712b14fa19a87a415b801e0e8ea641e9020f19f6",
  }),
  Object.freeze({
    migrationName: "000124_personal_account_operations",
    checksum:
      "2ffa20a0d21182bad0dfdce6653bc09b436cd72ab6335ac8065a17462bd3c6a1",
  }),
  Object.freeze({
    migrationName: "000125_hosted_codex_device_reconnect",
    checksum:
      "bf6d4c8df95d50a75f85d70c0e80f3c26963cdc86ea05125723af9568f14c54e",
  }),
]);

// Checkout-only Skills storage and its separate authorization attachment never
// enter managed92 SQL or historical96 execution. Retain the exact prior source
// manifest; pin only these new files instead of replacing protected baselines.
export const renderReviewSkillsCheckoutExtension = Object.freeze([
  Object.freeze({
    migrationName: "000136_review_skills",
    checksum:
      "ff5e720ea05be6dcfdfca134182d1c9da13bbc98426375b214fcaa3166d1af26",
  }),
  Object.freeze({
    migrationName: "000137_review_skills_capture",
    checksum:
      "40c3734f9e0b46a700a92d6a3fc8a7da01276511daae84b573e415afb52ed766",
  }),
]);

// Provider-owned memory adds authority and delivery metadata only. These exact
// files belong to the application checkout, never the managed92 repair catalog.
export const renderMemoryKnowledgeCheckoutExtension = Object.freeze([
  Object.freeze({
    migrationName: "000142_memory_knowledge_authority",
    checksum:
      "b40e545bd31f9d4cc65146c78b05afc8b662333e4945380ea4ed5f511d7ebcf9",
  }),
  Object.freeze({
    migrationName: "000143_memory_maintenance_fence",
    checksum:
      "1f8552ab409ece31536505c42ec62f0ef3df5b6220b7caa0cb90fcb2ee8aa83e",
  }),
]);

// Automatic source lineage and conversational processing are checkout-only.
// Pin the pair and its complete source inventory before retaining checkout155.
export const renderConversationalMemoryCheckoutExtension = Object.freeze([
  Object.freeze({
    migrationName: "000152_memory_automatic_source",
    checksum:
      "9aae83ee157aa25f862ffa8f4378dd4ed62ca34e22064c985d32c0399353ada2",
  }),
  Object.freeze({
    migrationName: "000153_conversation_processing",
    checksum:
      "df77c25b90c7811fb702f35a557a00465918a61d9caf6e34a3799c83b65638b8",
  }),
]);

export function partitionRenderSchemaHandoffCheckout(catalog) {
  if (
    !Array.isArray(catalog) ||
    catalog.some(
      (row, i) =>
        !row ||
        !/^\d{6}_[a-z0-9_]+$/u.test(row.migrationName) ||
        !/^[a-f0-9]{64}$/u.test(row.checksum) ||
        (i > 0 && row.migrationName <= catalog[i - 1].migrationName),
    )
  )
    fail("checkout_catalog");
  const conversationalMemoryMigrations = catalog.filter((row) =>
    renderConversationalMemoryCheckoutExtension.some(
      (extension) => extension.migrationName === row.migrationName,
    ),
  );
  if (conversationalMemoryMigrations.length > 0) {
    if (
      conversationalMemoryMigrations.length !==
        renderConversationalMemoryCheckoutExtension.length ||
      conversationalMemoryMigrations.some(
        (row, index) =>
          row.migrationName !==
            renderConversationalMemoryCheckoutExtension[index].migrationName ||
          row.checksum !==
            renderConversationalMemoryCheckoutExtension[index].checksum,
      ) ||
      manifest(catalog) !==
        "sha256:142e0ea44ad7c65c9e27e133c2902d35a88c1dcb39c0ea5274059fc81ae2de49"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => !conversationalMemoryMigrations.includes(row)),
    );
  }
  // Review history is checkout-only. Pin its SQL and the complete checkout155
  // before reducing to the previously reviewed Skills-catalog154 inventory.
  const reviewHistoryMigration = catalog.find(
    (row) => row.migrationName === "000151_review_history",
  );
  if (reviewHistoryMigration) {
    if (
      reviewHistoryMigration.checksum !==
        "276fc355d90fd41ba95797eeb21a73aa78755c0709a82426f33552ecb2c05274" ||
      manifest(catalog) !==
        "sha256:3d7b45be5b1654757f1bf72626e6f3f7c9b1351bb82ce93819bca2e4a38b7dbf"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== reviewHistoryMigration),
    );
  }
  // Checked Skills storage is checkout-only. Remove its exact, immutable SQL
  // identity first; the recursive checks still pin the full memory153 (or
  // prior repository151) source manifest and never expand managed92 SQL.
  const skillsCatalogMigration = catalog.find(
    (row) => row.migrationName === "000150_skills_catalog_security",
  );
  if (skillsCatalogMigration) {
    if (
      skillsCatalogMigration.checksum !==
      "4a5ecd80f83b0631982519fc747c411d0ed5d9b04624ee8e3d176a82ae96e4b8"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== skillsCatalogMigration),
    );
  }
  const memoryKnowledgeMigrations = catalog.filter((row) =>
    renderMemoryKnowledgeCheckoutExtension.some(
      (extension) => extension.migrationName === row.migrationName,
    ),
  );
  if (memoryKnowledgeMigrations.length > 0) {
    if (
      memoryKnowledgeMigrations.length !==
        renderMemoryKnowledgeCheckoutExtension.length ||
      memoryKnowledgeMigrations.some(
        (row, index) =>
          row.migrationName !==
            renderMemoryKnowledgeCheckoutExtension[index].migrationName ||
          row.checksum !==
            renderMemoryKnowledgeCheckoutExtension[index].checksum,
      ) ||
      manifest(catalog) !==
        "sha256:5d42e163ba89faae7c49fa4fa9ff65bc2a8b87a6774b57a5f70c6a027e4331dd"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => !memoryKnowledgeMigrations.includes(row)),
    );
  }
  // Repository-secret profile identities change a checkout-only table. Admit
  // the exact SQL and checkout151 before preserving the reviewed checkout150.
  const repositorySecretProfilesMigration = catalog.find(
    (row) => row.migrationName === "000149_api_key_repository_secret_profiles",
  );
  if (repositorySecretProfilesMigration) {
    if (
      repositorySecretProfilesMigration.checksum !==
        "1884b772c85adb0663fa3895307799b91f88133fb1941fc88aec1c56bd6e5579" ||
      manifest(catalog) !==
        "sha256:bde611c1eb4753d8d21f0f5ac2b97f2c93818aaf7fb48cc9181abe28aa708035"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== repositorySecretProfilesMigration),
    );
  }
  // Lifecycle verification is a checkout-only additive schema extension. Admit
  // its exact source catalog before preserving the reviewed checkout149 gate.
  const lifecycleVerificationMigration = catalog.find(
    (row) => row.migrationName === "000148_lifecycle_verification",
  );
  if (lifecycleVerificationMigration) {
    if (
      lifecycleVerificationMigration.checksum !==
        "00e6dca21ae3dcd9c61f729bb93e0319caf5b204ae67e29ba2889259e5db1b60" ||
      manifest(catalog) !==
        "sha256:ae1f73631c1ae9e359a22c421d7bb83751fd831f22ba77304be1d20d01878472"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== lifecycleVerificationMigration),
    );
  }
  // Mutation identities change only checkout Skills tables. Admit the exact
  // checkout149 source, then preserve the unchanged reviewed checkout148 gate.
  const reviewSkillsMutationIdentityMigration = catalog.find(
    (row) => row.migrationName === "000147_review_skills_mutation_identity",
  );
  if (reviewSkillsMutationIdentityMigration) {
    if (
      reviewSkillsMutationIdentityMigration.checksum !==
        "d5f36bdcddbfa3f252e61e3b4961b7e6102d5a2a4324850089e6bfec442d2883" ||
      manifest(catalog) !==
        "sha256:597739d44aa5f10551930c1349bed5c1a634b868fd55f9738b32b33ac230e897"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== reviewSkillsMutationIdentityMigration),
    );
  }
  // Dropping the schema 1-3 review configuration projection is checkout-only:
  // its columns and table entered after the managed catalog. Admit the exact
  // SQL and checkout148 before reducing to checkout147.
  const reviewConfigurationProjectionMigration = catalog.find(
    (row) =>
      row.migrationName === "000146_drop_review_configuration_projection",
  );
  if (reviewConfigurationProjectionMigration) {
    if (
      reviewConfigurationProjectionMigration.checksum !==
        "d42d8143d918aaf8bf3ac90c1488ec317bcdd3795c529c05f6a216da0931f5d9" ||
      manifest(catalog) !==
        "sha256:000decc06ca41637beceb84da74858f434d2300c3c4c3af8c96dcac0aee3efba"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== reviewConfigurationProjectionMigration),
    );
  }
  // Provider profiles add checkout-only tables, nullable columns and relaxed
  // projection nullability. Admit the exact SQL and checkout147 before
  // reducing to the statistics checkout146.
  const workspaceProviderProfilesMigration = catalog.find(
    (row) => row.migrationName === "000145_workspace_provider_profiles",
  );
  if (workspaceProviderProfilesMigration) {
    if (
      workspaceProviderProfilesMigration.checksum !==
        "e0e26a524c9bd14b20f1c6f51556afb6aea89de0fc79faadd61021ac6b6ada2c" ||
      manifest(catalog) !==
        "sha256:bf77d4720a7c41e4e9f427595e1a6ecc044149a74ec5a243aaacbbd5ba886cab"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== workspaceProviderProfilesMigration),
    );
  }
  // Statistics storage is checkout-only. Admit this exact complete checkout146
  // before reducing to the unchanged reviewed Skills/main145 authority gates.
  const statisticsMigration = catalog.find(
    (row) => row.migrationName === "000144_review_statistics",
  );
  if (statisticsMigration) {
    if (
      statisticsMigration.checksum !==
        "fded494bbdeed9164c6704f29b3ae17a19b9670e323942a28348d8ba22a8af19" ||
      manifest(catalog) !==
        "sha256:28c55f9026bfb1bd139bc25925571ea62e2c454a10e151ef6149aae0358a4178"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== statisticsMigration),
    );
  }
  // Skills accompany only an exact reviewed base. Strip the immutable pair
  // before the existing main143/142/141 and historical authority reductions.
  // Match both named rows: other additive migrations now sort around this pair.
  const skills = catalog.filter((row) =>
    renderReviewSkillsCheckoutExtension.some(
      (skill) => skill.migrationName === row.migrationName,
    ),
  );
  if (skills.length > 0) {
    const base = catalog.filter((row) => !skills.includes(row));
    if (
      skills.length !== renderReviewSkillsCheckoutExtension.length ||
      skills.some(
        (row, index) =>
          row.migrationName !==
            renderReviewSkillsCheckoutExtension[index].migrationName ||
          row.checksum !== renderReviewSkillsCheckoutExtension[index].checksum,
      ) ||
      ![
        "136:sha256:7a00ae60d98ffe6bdaf3bbb74a50eefed8ac60b94e55a443251cb480a47d48a8",
        "140:sha256:12ec2343e5de125175e4fc8946a9ab177034f60af43883b7c4ec8ac91a26ce48",
        "141:sha256:f57efc9ec8fd5f1efcd8f9cea07586957e5bd4bf983f02f252b30dc474a67ec8",
        "143:sha256:4fe4b459218a0cc56c8638b6f6d5a33d08d09579205d612b72d2781a7a0962bf",
      ].includes(`${base.length}:${manifest(base)}`)
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(base);
  }
  // The workspace draft-review flag is a checkout-only constant-default column.
  // Admit the exact SQL and checkout143 before reducing to checkout142.
  const workspaceDraftReviewMigration = catalog.find(
    (row) => row.migrationName === "000143_workspace_draft_review_setting",
  );
  if (workspaceDraftReviewMigration) {
    if (
      workspaceDraftReviewMigration.checksum !==
        "cc23c19feb97dd122d89cf080ee04fd49a95252dcbc4400b4cfa64704d430654" ||
      manifest(catalog) !==
        "sha256:4fe4b459218a0cc56c8638b6f6d5a33d08d09579205d612b72d2781a7a0962bf"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== workspaceDraftReviewMigration),
    );
  }
  // Optional reasoning changes only checkout nullability, not managed92 authority.
  const optionalReasoningMigration = catalog.find(
    (row) => row.migrationName === "000142_optional_gateway_reasoning",
  );
  if (optionalReasoningMigration) {
    if (
      optionalReasoningMigration.checksum !==
        "4414e3473290c6252cc06b9b5a10852cac5a93070c5b59c1b5c260113081b2c0" ||
      manifest(catalog) !==
        "sha256:a0cd29f30a38777a777aad492da123023a0c5258ed093589643655c96ebb5d7f"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== optionalReasoningMigration),
    );
  }
  // Memory projection receipts are checkout-only. Admit the exact SQL and
  // complete checkout141 before reducing to the previously qualified checkout.
  const memoryProjectionMigration = catalog.find(
    (row) => row.migrationName === "000141_memory_search_projections",
  );
  if (memoryProjectionMigration) {
    if (
      memoryProjectionMigration.checksum !==
        "4169d5f18ff4bafe6ce316060c06d569d108f4e13704b7c66692514221723c3e" ||
      manifest(catalog) !==
        "sha256:f57efc9ec8fd5f1efcd8f9cea07586957e5bd4bf983f02f252b30dc474a67ec8"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== memoryProjectionMigration),
    );
  }
  // Device sign-in adds only immutable enrollment method metadata. Admit the
  // exact extension before reducing to the previously qualified checkout.
  const oauthMethodMigration = catalog.find(
    (row) => row.migrationName === "000140_personal_oauth_method",
  );
  if (oauthMethodMigration) {
    if (
      oauthMethodMigration.checksum !==
        "aa1f8fb0d3bd5dffdcf7dd5435552f8aa846c6295d02fb2189b4e0e7356f0454" ||
      manifest(catalog) !==
        "sha256:12ec2343e5de125175e4fc8946a9ab177034f60af43883b7c4ec8ac91a26ce48"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== oauthMethodMigration),
    );
  }
  // MCP connection custody and its optional producer descriptor are checkout-only.
  // Admit exact SQL and the reviewed pre-usage or merged union before reducing it.
  const contextToolsMigration = catalog.find(
    (row) => row.migrationName === "000139_review_context_tools",
  );
  if (contextToolsMigration) {
    if (
      contextToolsMigration.checksum !==
        "b2ac7d2121b0869dcfa77ee37ff85a86fe3947dad4a88ed595d73492a5eafed4" ||
      ![
        "sha256:22d2cb47f5ec96e2b154ac07a375a19682243b7378df7a00f891a4713408b56b",
        "sha256:ecbb9d456aa70c06abbc301950005378b53afb25f2382f06d608589a4935a9dc",
      ].includes(manifest(catalog))
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== contextToolsMigration),
    );
  }
  // Optional PR-description enum/profile storage is checkout-only. Admit its
  // exact SQL and pre-usage or merged union; historical managed SQL stays unchanged.
  const prDescriptionMigration = catalog.find(
    (row) => row.migrationName === "000138_pr_description",
  );
  if (prDescriptionMigration) {
    if (
      prDescriptionMigration.checksum !==
        "4b41af195d5dd00df952d25d6c4999a64abf6cbc36351c2bd14d41f114cfe4e4" ||
      ![
        "sha256:af9bf892b5ec0e5817c9b1707869b8023ae5ce740af6e60b08c5aba328ec2694",
        "sha256:c9fd4bb76d56166a80ec52fd9f54156d5951d375d47ed57bd02fd7dd40f7ccd0",
      ].includes(manifest(catalog))
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== prDescriptionMigration),
    );
  }
  // Usage is an additive checkout-only extension. Preserve the managed92
  // authority and admit only this exact reviewed SQL and complete checkout137.
  const usageMigration = catalog.find(
    (row) => row.migrationName === "000136_provider_usage",
  );
  if (usageMigration) {
    if (
      usageMigration.checksum !==
        "1f59f95079c29b0da051e0e67b965336107eee63c7bb921e626cd656ce696c48" ||
      manifest(catalog) !==
        "sha256:ed3d27f7417f66b56acf823358933d67ef6c3fae0cbcc88ed89a79cb4a1e27b5"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== usageMigration),
    );
  }
  // The merged checkout136 retains both independently released134 extensions
  // and the scoped lock135. Only this exact union may reduce to checkout135.
  const accountLifecycleMigration = catalog.find(
    (row) => row.migrationName === "000134_account_lifecycle",
  );
  if (accountLifecycleMigration) {
    if (
      accountLifecycleMigration.checksum !==
        "92247cf49264abac1e2c6eaed78d741b57d8d21a28818e9d0264af89872ec213" ||
      ![
        "sha256:7a00ae60d98ffe6bdaf3bbb74a50eefed8ac60b94e55a443251cb480a47d48a8",
        "sha256:33fadb5470c593e0858e8e7feb47132c2931270e42ee1f0381940da9ef6dff5c",
      ].includes(manifest(catalog))
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== accountLifecycleMigration),
    );
  }
  // The runtime checkout lock adds narrowly scoped authority, so admit only
  // its reviewed SQL and complete checkout135. It never enters managed92 SQL.
  const checkoutLockMigration = catalog.find(
    (row) => row.migrationName === "000135_review_run_checkout_repository_lock",
  );
  if (checkoutLockMigration) {
    if (
      checkoutLockMigration.checksum !==
        "b14b3974c83fffabb95b9f52b12b522561f47862917ad160d8a272afa138e186" ||
      manifest(catalog) !==
        "sha256:2624f6f55b524953b90c99415f1e0b216108e322fdb7b6e2ce539e5ce9935297"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== checkoutLockMigration),
    );
  }
  // OCR's additive provider enum is admitted only as the exact checkout134
  // extension; published checkout133 and historical authority stay unchanged.
  const ocrProviderMigration = catalog.find(
    (row) => row.migrationName === "000134_review_provider_kind_v2_ocr",
  );
  if (ocrProviderMigration) {
    if (
      ocrProviderMigration.checksum !==
        "7f68071ce4a207434ac3434bbd793201b767ff3ae7799c2d55feb1589484573d" ||
      manifest(catalog) !==
        "sha256:b1cf647d94be3e446de05c85705616ab6b48cfb4b653e5557881971580cb4943"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== ocrProviderMigration),
    );
  }
  // First-time SCM identity bind admitted as the exact checkout133 extension
  // over the unchanged published policy132 catalog.
  const identityBindMigration = catalog.find(
    (row) => row.migrationName === "000133_allow_first_time_scm_identity_bind",
  );
  if (identityBindMigration) {
    if (
      identityBindMigration.checksum !==
        "bd918df942405f36c88dafa7a05c7f383439f913915de5ab3af8214cff7fd5a6" ||
      manifest(catalog) !==
        "sha256:e88927dcec3f1ec6fdc966be8d937160f8fccbaf59720b99fdc6386e605d5d5e"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== identityBindMigration),
    );
  }
  // Current policy/profile extension over the unchanged published personal131 catalog.
  const policyMigration = catalog.find(
    (row) => row.migrationName === "000132_review_policy_schema_v3",
  );
  if (policyMigration) {
    if (
      policyMigration.checksum !==
        "ac0abf93d6088957825731f178903709d2b8535a7e9894eb2236449396711f21" ||
      manifest(catalog) !==
        "sha256:13efdc28bd5b1920373a3cfef10785c377cd7b4f2f648a00d3e2817d9f0422c7"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== policyMigration),
    );
  }
  // Positive local non-entry release is admitted only as exact checkout131.
  // Recurse through the unchanged pinned canonical130 contract.
  const unenteredClaimMigration = catalog.find(
    (row) => row.migrationName === "000131_personal_canonical_unentered_claim",
  );
  if (unenteredClaimMigration) {
    if (
      unenteredClaimMigration.checksum !==
        "342221539d29efff72a110415311e43556e7b83dddaddf763610d9bc734c8ef3" ||
      manifest(catalog) !==
        "sha256:826c8dd79768289887e3dcde7c632a4fc3bc84527b72e5fef39042bfad324f11"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== unenteredClaimMigration),
    );
  }
  // Canonical H coordination is admitted only as the exact complete checkout130.
  // Remove its pinned row, then recurse through unchanged snapshot129 admission.
  const personalCanonicalMigration = catalog.find(
    (row) => row.migrationName === "000130_personal_canonical_operations",
  );
  if (personalCanonicalMigration) {
    if (
      personalCanonicalMigration.checksum !==
        "aefb85f4e439bf7526a3b7c658ec3eeaec6f70c10a26435ca63c25c9f6ef11ca" ||
      manifest(catalog) !==
        "sha256:fab01456f5745f715b91efa23358b1261c717330155a14865d939471a0e8a19e"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== personalCanonicalMigration),
    );
  }
  // Inert H snapshot-v2 storage is an exact checkout-only extension. Its SQL
  // changes neither managed92/historical source nor SQL128 API column authority.
  const personalSnapshotMigration = catalog.find(
    (row) => row.migrationName === "000129_personal_run_snapshot_v2",
  );
  if (personalSnapshotMigration) {
    if (
      personalSnapshotMigration.checksum !==
        "d36995df0392fdaf9ad5f39d6204c18bc0c78b400963c549547648c48b64e0ab" ||
      manifest(catalog) !==
        "sha256:19c80297e4a4d01882c1253cbc1a62df6a95e0f916992d308ff627f30d7a6c25"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== personalSnapshotMigration),
    );
  }
  // Owner deletion is admitted only in the exact complete checkout128.
  // Remove only its pinned row, then reuse the unchanged128/126 projections.
  const ownerDeletionMigration = catalog.find(
    (row) => row.migrationName === "000127_owner_workspace_deletion",
  );
  if (ownerDeletionMigration) {
    if (
      ownerDeletionMigration.checksum !==
        "c2a78c83fd5b376b800a189099fcc2fa6f359b61b2188e6819dfdf13d362e0f3" ||
      manifest(catalog) !==
        "sha256:573ad770b1198ff48207d023af722679f7eb4e67c9603c883a179692251d5c37"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== ownerDeletionMigration),
    );
  }
  // C1 lock privileges are a checkout-only addition. Pin its exact complete
  // source, then validate unchanged126; managed92/historical ledgers stay frozen.
  const accountAdmissionMigration = catalog.find(
    (row) => row.migrationName === "000128_account_admission_row_lock",
  );
  if (accountAdmissionMigration) {
    if (
      accountAdmissionMigration.checksum !==
        "9d53bafb4a8f9b5b9ca9ab640c6765ff425baf87d4c5d8b80b81cc690486fe9f" ||
      manifest(catalog) !==
        "sha256:25978108fdc33470b190776a8c0705473c0bcfb60b18d4d631da64eb315d6f42"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== accountAdmissionMigration),
    );
  }
  // The MiMO correction is admitted only with its exact complete checkout126.
  // Project back to the already-pinned source history for managed admission;
  // this never changes an applied119 ledger checksum or the managed92 catalog.
  const mimoAuthMigration = catalog.find(
    (row) => row.migrationName === "000126_review_configuration_mimo_auth_kind",
  );
  if (mimoAuthMigration) {
    if (
      mimoAuthMigration.checksum !==
        "d3e963ce9137d0d437dbbdf47cf9aff3dc9666d1e26b200a616ee7eb9c17603a" ||
      !catalog.some(
        (row) =>
          row.migrationName === "000119_review_configuration_gateway_binding" &&
          row.checksum ===
            "381f4bfa3f8d05e5f82fb27bf8aafb6a75fe1779ca5ac2384154618f95d0e152",
      ) ||
      manifest(catalog) !==
        "sha256:5b565a1ad6f9ee710f45af02614b911e68346773226406e1209f173f1e07b30a"
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog
        .filter((row) => row !== mimoAuthMigration)
        .map((row) =>
          row.migrationName === "000119_review_configuration_gateway_binding"
            ? {
                ...row,
                checksum:
                  "2c0dde1720111063059d5226c6011c15389b6877a6a1f924177a24a36aa81a70",
              }
            : row,
        ),
    );
  }
  // This independently published checkout addition is not part of the old
  // managed or historical manifests. Validate its exact bytes and predecessor,
  // then validate the complete original history without changing those pins.
  const providerKeyMigration = catalog.find(
    (row) =>
      row.migrationName === "000110_provider_api_key_workspace_management",
  );
  if (providerKeyMigration) {
    if (
      providerKeyMigration.checksum !==
        "d69beaa182fd49ad231bb86b2af4b9d53af3c54cab3a12fa3ca910e7a4379208" ||
      !catalog.some(
        (row) =>
          row.migrationName === "000109_sdk_growth_verifier_assignment_lock",
      )
    )
      fail("checkout_extension");
    return partitionRenderSchemaHandoffCheckout(
      catalog.filter((row) => row !== providerKeyMigration),
    );
  }
  const managed = [];
  let extensions = 0;
  for (const row of catalog) {
    const extension = checkoutExtensions.find(
      (entry) => entry.migrationName === row.migrationName,
    );
    if (!extension) managed.push(row);
    else {
      if (row.checksum !== extension.checksum) fail("checkout_extension");
      extensions++;
    }
  }
  if (
    ![
      0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
      22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
    ].includes(extensions)
  )
    fail("checkout_extension");
  if (
    extensions === 3 &&
    manifest(catalog) !==
      "sha256:6c62ac869a47211043f8fffdd7af105cb6bd677b65462033195d41e7d7aafa2e"
  )
    fail("checkout_manifest");
  if (
    extensions === 4 &&
    manifest(catalog) !==
      "sha256:5faad7059a2f57055086dd1571e87706c261a486e8952334401f1d91cc41c97b"
  )
    fail("checkout_manifest");
  if (
    extensions === 5 &&
    manifest(catalog) !==
      "sha256:d55f22c9317678a501fbef170b8f0f7b238ad4f1c1fa4232a02e7b291053c273"
  )
    fail("checkout_manifest");
  if (
    extensions === 6 &&
    manifest(catalog) !==
      "sha256:c6b3c39ffd4631d53402f7402700a352d75208bb125b9e48d52d42d5e6a1398c"
  )
    fail("checkout_manifest");
  if (
    extensions === 7 &&
    manifest(catalog) !==
      "sha256:5b967b29970341cad78f4388cd046606464928c5f20392dc7353fa929b1278dc"
  )
    fail("checkout_manifest");
  if (
    extensions === 8 &&
    manifest(catalog) !==
      "sha256:8fdb700169875a4db08732aa0332b619538527fa37e06b71d5f296fa19a30d26"
  )
    fail("checkout_manifest");
  if (
    extensions === 9 &&
    manifest(catalog) !==
      "sha256:dfcbd39f6b18377d7da5b4c1cd1351ae058ade6dc08ba2ebf33ffec5506c9804"
  )
    fail("checkout_manifest");
  if (
    extensions === 10 &&
    manifest(catalog) !==
      "sha256:a2e683899abcc3f9adf377cbc8ecb2e051d84a0e7c6e9fffc0fe32fa150c3983"
  )
    fail("checkout_manifest");
  if (
    extensions === 11 &&
    manifest(catalog) !==
      "sha256:d8c18d54579a469dc03635213cfc3e61e2d9564ed775ee67653482f9776c7287"
  )
    fail("checkout_manifest");
  if (
    extensions === 12 &&
    manifest(catalog) !==
      "sha256:8c76fd167e6483aeced3efba870d8f21fcb9b4f9f5b142ee9a767ee011096f9c"
  )
    fail("checkout_manifest");
  if (
    extensions === 13 &&
    manifest(catalog) !==
      "sha256:51fb004c51bbd2612b04316903695d2d445cb98b64e04f1c054492206683677c"
  )
    fail("checkout_manifest");
  if (
    extensions === 14 &&
    manifest(catalog) !==
      "sha256:c4849371f75ab6239dc91a1ec2ba7ae5bde6d7a5368bc1c7d5509d3d7959fc43"
  )
    fail("checkout_manifest");
  if (
    extensions === 15 &&
    manifest(catalog) !==
      "sha256:118042ec41e57c6a7f35e35d48ab9365ee80f3a1acb864181a7cf9ebf01c72bc"
  )
    fail("checkout_manifest");
  if (
    extensions === 16 &&
    manifest(catalog) !==
      "sha256:1d97937b91028e91b3987eee05057fbe915b7f2354cf2464c8fb507f1086590f"
  )
    fail("checkout_manifest");
  if (
    extensions === 17 &&
    manifest(catalog) !==
      "sha256:1a5470960ccf766827bb58fc0a270553f002802e0019225adb4a0dfcf2b591af"
  )
    fail("checkout_manifest");
  if (
    extensions === 18 &&
    manifest(catalog) !==
      "sha256:48019e5f9ad81af25742e30903b83d7053affa263c2e0674a4f9e4c909b4ec26"
  )
    fail("checkout_manifest");
  if (
    extensions === 19 &&
    manifest(catalog) !==
      "sha256:7e1d7018a5f959cfd5d237fd2ac18dd1436580b05ab0da7a9416bc7dfb842988"
  )
    fail("checkout_manifest");
  if (
    extensions === 20 &&
    manifest(catalog) !==
      "sha256:24a99e65c00ef46f0a63d0823ec12f38575b793e794c82990bd5c3ecfd0a2271"
  )
    fail("checkout_manifest");
  if (
    extensions === 21 &&
    manifest(catalog) !==
      "sha256:06b7ead8634045dd96f1e79626cb1fdcee3bd147ca5068e9fe001705271f5446"
  )
    fail("checkout_manifest");
  if (
    extensions === 22 &&
    manifest(catalog) !==
      "sha256:15a397089c81b84540534361777b74a69a48955df7db81bf6353130d51aa6ed0"
  )
    fail("checkout_manifest");
  if (
    extensions === 23 &&
    manifest(catalog) !==
      "sha256:30f68ffc62e0b46815bc007339d83aa7894b61b23f301c012b8990713cc0ad14"
  )
    fail("checkout_manifest");
  if (
    extensions === 24 &&
    ![
      "sha256:c5c0618f105799d06d21424433cec4a59fc052e63f594c2aace0657ebb52d1dd",
      "sha256:afa28624860779e511a551d38910b94b336b0e638c696cadeffad3f62101c1dc",
    ].includes(manifest(catalog))
  )
    fail("checkout_manifest");
  if (
    extensions === 25 &&
    manifest(catalog) !==
      "sha256:6bd2cd3c077f6cf56735c7192dd6e0f84a21bbec5a2657271cb5afaf1d2f20cf"
  )
    fail("checkout_manifest");
  if (
    extensions === 26 &&
    manifest(catalog) !==
      "sha256:2ee71e958dc9b4a564fd113a4983917ad6e3f7ea22cd19fa29bdb7dc72320e1c"
  )
    fail("checkout_manifest");
  if (
    extensions === 27 &&
    manifest(catalog) !==
      "sha256:f998e11bee1748adecf31dc07ec61d59b55ead60b2734a71f90065d3f9f4aa6b"
  )
    fail("checkout_manifest");
  if (
    extensions === 28 &&
    manifest(catalog) !==
      "sha256:5f01c4416620cf984ffa5fee8dbb26bcf171ae3a89ec4e4b8615e4c7c8461c64"
  )
    fail("checkout_manifest");
  if (
    extensions === 29 &&
    manifest(catalog) !==
      "sha256:858537d185e32ef6258ddf674b5a201e6cc0c4e44fa948a18af23d6dd55905ec"
  )
    fail("checkout_manifest");
  if (
    extensions === 30 &&
    manifest(catalog) !==
      "sha256:5629630be035cbf1677692e840bc07c7292729bfb5bfc0c242f38179f3230df4"
  )
    fail("checkout_manifest");
  if (
    extensions === 31 &&
    manifest(catalog) !==
      "sha256:f26da08b44ad6830f4486f93ed33979acda7b5669a8550601c34dbf9c0322443"
  )
    fail("checkout_manifest");
  if (
    extensions === 32 &&
    manifest(catalog) !==
      "sha256:cf270d22a10557c8ebe66cc7cb5e47eb18a5c43274981b46d340123e7d6ba41a"
  )
    fail("checkout_manifest");
  assertRenderSchemaHandoffCatalog(managed);
  return Object.freeze(managed);
}

// Inspect every directory entry on every read. The shared canonical scanner
// deliberately filters names and caches its inventory; managed admission must
// reject hidden additions without changing that separate canonical contract.
export function readRenderSchemaHandoffCatalog() {
  return partitionRenderSchemaHandoffCheckout(
    readRenderManagedCheckoutInventory(),
  );
}

/** @returns {ReadonlyArray<Readonly<{migrationName: string, checksum: string}>>} */
export function readRenderManagedCheckoutInventory() {
  const directory = new URL(
    "../../packages/platform/db/prisma/migrations/",
    import.meta.url,
  );
  let catalog;
  try {
    const entries = readdirSync(directory, { withFileTypes: true });
    if (
      entries.some(
        (entry) =>
          !entry.isDirectory() || !/^\d{6}_[a-z0-9_]+$/u.test(entry.name),
      )
    )
      fail("checkout_inventory");
    catalog = entries.map(({ name: migrationName }) => {
      const sql = new URL(`${migrationName}/migration.sql`, directory);
      if (!lstatSync(sql).isFile()) fail("checkout_inventory");
      return Object.freeze({
        migrationName,
        checksum: sha256(readFileSync(sql)),
      });
    });
  } catch {
    fail("checkout_inventory");
  }
  catalog.sort((a, b) =>
    a.migrationName < b.migrationName
      ? -1
      : a.migrationName > b.migrationName
        ? 1
        : 0,
  );
  partitionRenderSchemaHandoffCheckout(catalog);
  return Object.freeze(catalog);
}

export function assertRenderSchemaHandoffLedger(catalog, ledger, phase) {
  assertRenderSchemaHandoffCatalog(catalog);
  if (!["baseline", "target"].includes(phase)) fail("ledger_phase");
  const count =
    phase === "baseline"
      ? renderSchemaHandoffMigrationContract.baselineCount
      : renderSchemaHandoffMigrationContract.targetCount;
  if (!Array.isArray(ledger) || ledger.length !== count) fail("ledger_count");
  // SQL must return every row, including failed and rolled-back attempts.
  // No filtering or deduplication may convert ambiguous history into a prefix.
  const ordered = [...ledger].sort((a, b) =>
    String(a?.migrationName).localeCompare(String(b?.migrationName), "en"),
  );
  if (
    ordered.some(
      (row, i) =>
        !row ||
        row.migrationName !== catalog[i].migrationName ||
        row.checksum !== catalog[i].checksum ||
        row.finished !== true ||
        row.rolledBack !== false ||
        row.appliedStepsCount !== 1 ||
        row.hasLogs !== false,
    )
  )
    fail("ledger_prefix");
}

// No WHERE, DISTINCT or success-only aggregation: a failed attempt is evidence,
// even if Prisma later recorded a successful row with the same migration name.
// Logs may contain secrets; retain presence and exact-byte digest, not contents.
export const renderManagedLedgerSql = `SET search_path = pg_catalog, public;
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'id',id,'migrationName',migration_name,'checksum',checksum,
  'startedAt',to_char(started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'finishedAt',to_char(finished_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'rolledBackAt',to_char(rolled_back_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'appliedStepsCount',applied_steps_count,
  'logsPresent',logs IS NOT NULL,'hasLogs',logs IS NOT NULL AND logs <> '',
  'logsDigest',CASE WHEN logs IS NULL THEN NULL ELSE
    'sha256:'||encode(sha256(convert_to(logs,'UTF8')),'hex') END
) ORDER BY migration_name COLLATE "C",id COLLATE "C"),'[]'::jsonb)
FROM public._prisma_migrations;`;

// Run on a fresh custody-role connection. The lock and read are separate
// READ COMMITTED statements: a SELECT sharing the lock statement's earlier
// snapshot could misreport a gate update that committed while the lock waited.
// All reads use existing custody grants; no owner SELECT or ACL widening.
export const renderManagedTerminalCustodySql = `BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '120000ms';
DO $custody_lock$ BEGIN
  PERFORM public.hosted_codex_lock_comment_token_runtime_gate();
END $custody_lock$;
SELECT jsonb_build_object('gateStatus',g.status,'authzEpoch',g."authzEpoch"::text,
  'revision',g.revision::text,'authorityProbeCount',
  (SELECT count(*) FROM public.hosted_codex_comment_token_authority_snapshot(NULL)))
FROM public."HostedCodexRuntimeGate" g WHERE g.id='global';
ROLLBACK;`;

// Canonicalize JSON object keys only. Array ordering is part of each reviewed
// projection's contract; a reordered or duplicated fact is never normalized away.
export function renderManagedEvidenceDigest(value) {
  const canonical = (item, depth = 0) => {
    if (depth > 32) fail("managed_evidence_json");
    if (item === null || ["string", "boolean"].includes(typeof item))
      return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length)
        fail("managed_evidence_json");
      return item.map((child) => canonical(child, depth + 1));
    }
    if (
      typeof item !== "object" ||
      Object.getPrototypeOf(item) !== Object.prototype
    )
      fail("managed_evidence_json");
    return Object.fromEntries(
      Object.keys(item)
        .sort()
        .map((key) => [key, canonical(item[key], depth + 1)]),
    );
  };
  return `sha256:${sha256(JSON.stringify(canonical(value)))}`;
}

const timestamp = (value) => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value)
  )
    return false;
  const date = new Date(value);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString() === `${value.slice(0, 23)}Z`
  );
};
const ledgerKeys = [
  "id",
  "migrationName",
  "checksum",
  "startedAt",
  "finishedAt",
  "rolledBackAt",
  "appliedStepsCount",
  "logsPresent",
  "hasLogs",
  "logsDigest",
]
  .sort()
  .join();

export function inspectRenderManagedLedger(catalog, ledger, phase) {
  assertRenderSchemaHandoffCatalog(catalog);
  return inspectRenderManagedLedgerRows(
    catalog,
    ledger,
    renderManagedMigrationPhase(phase),
  );
}

// Internal strict row validator. Public phase wrappers must first pin the catalog
// and bounds; this helper is evidence validation, never phase admission.
export function inspectRenderManagedLedgerRows(catalog, ledger, contract) {
  if (
    !Array.isArray(ledger) ||
    ledger.length < contract.baselineCount ||
    ledger.length > contract.targetCount ||
    (contract.atomic &&
      ![contract.baselineCount, contract.targetCount].includes(ledger.length))
  )
    fail("managed_ledger_count");
  const ordered = [...ledger].sort((a, b) =>
    String(a?.migrationName) < String(b?.migrationName) ? -1 : 1,
  );
  const ids = new Set();
  const emptyLogDigest = `sha256:${sha256("")}`;
  for (const [index, row] of ordered.entries()) {
    if (
      !row ||
      Object.keys(row).sort().join() !== ledgerKeys ||
      typeof row.id !== "string" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(row.id) ||
      ids.has(row.id) ||
      row.migrationName !== catalog[index].migrationName ||
      row.checksum !== catalog[index].checksum ||
      !timestamp(row.startedAt) ||
      !timestamp(row.finishedAt) ||
      row.finishedAt < row.startedAt ||
      row.rolledBackAt !== null ||
      row.appliedStepsCount !== 1 ||
      row.hasLogs !== false ||
      !(
        (row.logsPresent === false && row.logsDigest === null) ||
        (row.logsPresent === true && row.logsDigest === emptyLogDigest)
      )
    )
      fail("managed_ledger_history");
    ids.add(row.id);
  }
  return Object.freeze({
    count: ordered.length,
    position:
      ordered.length === contract.targetCount
        ? "target"
        : ordered.length === contract.baselineCount
          ? "baseline"
          : "partial",
    manifest: manifest(ordered),
    ledgerDigest: renderManagedEvidenceDigest(ordered),
    pending: Object.freeze(catalog.slice(ordered.length, contract.targetCount)),
  });
}

const schemaOwner = "reviewrouter_release_schema_owner";
const managedOwner = "reviewrouter";
const temporaryMembership = Object.freeze({
  role: schemaOwner,
  member: managedOwner,
  grantor: managedOwner,
  adminOption: false,
  inheritOption: true,
  setOption: true,
});
export const renderManagedMembershipSql = `SET search_path = pg_catalog, public;
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'role',parent.rolname,'member',member.rolname,'grantor',grantor.rolname,
  'adminOption',m.admin_option,'inheritOption',m.inherit_option,'setOption',m.set_option
) ORDER BY grantor.rolname COLLATE "C"),'[]'::jsonb)
FROM pg_catalog.pg_auth_members m
LEFT JOIN pg_catalog.pg_roles parent ON parent.oid=m.roleid
LEFT JOIN pg_catalog.pg_roles member ON member.oid=m.member
LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid=m.grantor
WHERE m.roleid='${schemaOwner}'::regrole AND m.member='${managedOwner}'::regrole;`;

// These statements preserve the provider-granted ADMIN recovery edge. The
// temporary self-grant intentionally has both INHERIT and SET, as in r6 evidence.
export const renderManagedTemporaryMembershipSql = `GRANT ${schemaOwner} TO ${managedOwner}
WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY ${managedOwner};`;
export const renderManagedMembershipCleanupSql = `REVOKE ${schemaOwner} FROM ${managedOwner}
GRANTED BY ${managedOwner} RESTRICT;`;

export function classifyRenderManagedMembership(rows, reviewedOriginal) {
  if (
    !reviewedOriginal ||
    reviewedOriginal.role !== schemaOwner ||
    reviewedOriginal.member !== managedOwner ||
    typeof reviewedOriginal.grantor !== "string" ||
    !/^[a-z_][a-z0-9_]{0,62}$/u.test(reviewedOriginal.grantor) ||
    reviewedOriginal.grantor === managedOwner ||
    reviewedOriginal.adminOption !== true ||
    reviewedOriginal.inheritOption !== false ||
    reviewedOriginal.setOption !== false ||
    Object.keys(reviewedOriginal).sort().join() !==
      Object.keys(temporaryMembership).sort().join()
  )
    fail("managed_original_membership");
  const equal = (a, b) =>
    renderManagedEvidenceDigest(a) === renderManagedEvidenceDigest(b);
  if (!Array.isArray(rows)) fail("managed_membership_unknown");
  if (rows.length === 1 && equal(rows[0], reviewedOriginal)) return "original";
  if (
    rows.length === 2 &&
    rows.filter((r) => equal(r, reviewedOriginal)).length === 1 &&
    rows.filter((r) => equal(r, temporaryMembership)).length === 1
  )
    return "temporary";
  fail("managed_membership_drift");
}

export function assertRenderManagedRoleBranch(roles) {
  if (!Array.isArray(roles)) fail("managed_roles_unknown");
  const owners = roles.filter((role) => role?.name === schemaOwner);
  const operators = roles.filter(
    (role) => role?.name === "reviewrouter_release_migration",
  );
  if (!owners.length && !operators.length)
    fail("managed_roles_self_hosted_branch");
  if (owners.length !== 1 || operators.length !== 1)
    fail("managed_roles_partial");
  for (const [key, value] of Object.entries({
    canLogin: false,
    superuser: false,
    bypassRls: false,
    replication: false,
    createDatabase: false,
    createRole: false,
  }))
    if (owners[0][key] !== value) fail("managed_schema_owner_role");
  for (const [key, value] of Object.entries({
    canLogin: true,
    superuser: false,
    bypassRls: false,
    replication: false,
    createDatabase: false,
    createRole: false,
  }))
    if (operators[0][key] !== value) fail("managed_release_role");
}

// No production-shaped managed baseline/postcondition captures have independent
// approval in this checkout. Review must pin complete contracts in source;
// neither a CLI path, an environment digest nor a fixture can populate this map.
const reviewedManagedContracts = Object.freeze({
  "managed-retained-upgrade": null,
  "managed-schema-handoff": null,
});

export function readReviewedRenderManagedContract(phase) {
  renderManagedMigrationPhase(phase);
  const review = reviewedManagedContracts[phase];
  if (!review) fail("managed_independent_review_missing");
  const bytes = readFileSync(new URL(review.path, import.meta.url));
  if (`sha256:${sha256(bytes)}` !== review.digest) fail("managed_review_bytes");
  const contract = JSON.parse(bytes.toString("utf8"));
  if (
    contract.phase !== phase ||
    contract.version !== 1 ||
    contract.sourceCommit !==
      renderSchemaHandoffMigrationContract.sourceCommit ||
    contract.sourceTree !== renderSchemaHandoffMigrationContract.sourceTree
  )
    fail("managed_review_identity");
  return contract;
}

// Return the complete default-ACL catalog. The caller must bind its relevant
// principals to the separately reviewed role and grantor-aware membership
// policy before interpreting applicability. LEFT joins preserve unresolved
// OIDs and empty ACL overrides as rows.
export const renderSchemaHandoffDefaultAclSql = `SET search_path = pg_catalog, public;
SELECT jsonb_build_object(
  'version',1,
  'rows',COALESCE(jsonb_agg(jsonb_build_object(
    'oid',d.oid::text,'owner',owner.rolname,
    'schema',CASE WHEN d.defaclnamespace=0 THEN '*' ELSE n.nspname END,
    'objectType',d.defaclobjtype,
    'entries',CASE WHEN d.defaclacl IS NULL THEN NULL ELSE (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,
        'grantor',grantor.rolname,'privilege',a.privilege_type,
        'grantable',a.is_grantable
      ) ORDER BY a.grantee,a.grantor,a.privilege_type),'[]'::jsonb)
      FROM pg_catalog.aclexplode(d.defaclacl) a
      LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=a.grantee
      LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid=a.grantor
    ) END
  ) ORDER BY d.oid),'[]'::jsonb)
)
FROM pg_catalog.pg_default_acl d
LEFT JOIN pg_catalog.pg_roles owner ON owner.oid=d.defaclrole
LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace;`;

// An empty set of applicable rows is valid. An override row with an empty
// aclitem[] is a distinct policy change. Missing observations and unresolved
// identities must never be coerced to the valid empty set.
export function assertEmptyApplicableRenderDefaultAcl(observation, principals) {
  if (
    !Array.isArray(principals) ||
    principals.length === 0 ||
    principals.some((name) => typeof name !== "string" || !name) ||
    new Set(principals).size !== principals.length ||
    observation?.version !== 1 ||
    !Array.isArray(observation.rows)
  )
    fail("default_acl_unknown");
  const seen = new Set();
  for (const row of observation.rows) {
    if (
      !row ||
      typeof row.oid !== "string" ||
      !/^[1-9][0-9]*$/u.test(row.oid) ||
      seen.has(row.oid) ||
      typeof row.owner !== "string" ||
      !row.owner ||
      typeof row.schema !== "string" ||
      !row.schema ||
      !["r", "S", "f", "T", "n"].includes(row.objectType) ||
      !Array.isArray(row.entries) ||
      row.entries.some(
        (entry) =>
          !entry ||
          typeof entry.grantee !== "string" ||
          !entry.grantee ||
          typeof entry.grantor !== "string" ||
          !entry.grantor ||
          typeof entry.privilege !== "string" ||
          !entry.privilege ||
          typeof entry.grantable !== "boolean",
      )
    )
      fail("default_acl_unresolved");
    seen.add(row.oid);
    if (
      ["*", "public"].includes(row.schema) &&
      (principals.includes(row.owner) ||
        row.entries.some(
          (entry) =>
            entry.grantee === "PUBLIC" ||
            principals.includes(entry.grantee) ||
            principals.includes(entry.grantor),
        ))
    )
      fail("default_acl_policy");
  }
}
