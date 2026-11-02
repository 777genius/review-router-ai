import { isLoopbackHostname } from "@reviewrouter/shared";
import { versionedProviderSecretNamePattern } from "./provider-secret-namespace";
import {
  codexRuntimeMigrationReusableWorkflowPath,
  codexRuntimeMigrationWorkflowPath,
} from "./runtime-migration";

export type CodexRuntimeMigrationWorkflowInput = Readonly<{
  targetActionRef: string;
  setupBaseUrl: string;
  providerInstanceId: string;
  sourceNamespaceId: string;
  sourceNamespaceEpoch: string;
  sourceSecretName: string;
}>;

/** The first setup PR installs only this finite bootstrap, not a new review engine. */
export function renderCodexRuntimeMigrationWorkflow(
  input: CodexRuntimeMigrationWorkflowInput,
): string {
  const sha = /^777genius\/review-router@([a-f0-9]{40})$/u.exec(
    input.targetActionRef,
  )?.[1];
  const url = new URL(input.setupBaseUrl);
  if (
    !sha ||
    !/^[A-Za-z0-9_.:-]{8,180}$/u.test(input.providerInstanceId) ||
    !/^[A-Za-z0-9_.:-]{8,180}$/u.test(input.sourceNamespaceId) ||
    !/^[1-9][0-9]*$/u.test(input.sourceNamespaceEpoch) ||
    !versionedProviderSecretNamePattern.test(input.sourceSecretName) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && isLoopbackHostname(url.hostname)))
  ) {
    throw new Error("codex_runtime_migration_workflow_invalid");
  }
  return `# Managed by ReviewRouter: credential-preserving runtime migration v1
# Removed by the final namespace setup PR after a confirmed seed.
name: ReviewRouter runtime migration
run-name: ReviewRouter runtime migration \${{ inputs.migration_id }}
on:
  workflow_dispatch:
    inputs:
      migration_id:
        description: Non-secret migration identifier from ReviewRouter
        required: true
        type: string
permissions: {}
jobs:
  migrate:
    permissions:
      contents: read
      id-token: write
    uses: ${codexRuntimeMigrationReusableWorkflowPath}@${sha}
    with:
      migration_id: \${{ inputs.migration_id }}
      setup_base_url: ${JSON.stringify(url.toString().replace(/\/$/u, ""))}
      provider_instance_id: ${JSON.stringify(input.providerInstanceId)}
      source_namespace_id: ${JSON.stringify(input.sourceNamespaceId)}
      source_namespace_epoch: ${JSON.stringify(input.sourceNamespaceEpoch)}
    secrets:
      codex_auth_json: \${{ secrets.${input.sourceSecretName} }}
`;
}

export const codexRuntimeMigrationCleanup = {
  path: codexRuntimeMigrationWorkflowPath,
  operation: "delete" as const,
  markerGroups: [
    ["# Managed by ReviewRouter: credential-preserving runtime migration v1"],
    [codexRuntimeMigrationReusableWorkflowPath],
  ],
};
