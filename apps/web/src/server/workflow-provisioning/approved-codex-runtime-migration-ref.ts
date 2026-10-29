import { codexRuntimeMigrationWorkflowPath } from "@reviewrouter/features-provider-setup";
import { parseDocument } from "yaml";
import { z } from "zod";
import { resolveCodexRotatingSeedScriptDescriptor } from "../codex-rotating-seed-script";

export function assertCodexRuntimeMigrationTargetWorkflow(
  source: string,
): void {
  const parsed = parseDocument(source, { uniqueKeys: true });
  if (
    parsed.errors.length > 0 ||
    !source.startsWith(
      "# ReviewRouter credential-preserving runtime migration v1\n",
    )
  ) {
    throw new Error("codex_runtime_migration_target_unavailable");
  }
  const workflow = z
    .object({
      on: z
        .object({
          workflow_call: z
            .object({
              inputs: z.record(
                z.string(),
                z.object({
                  type: z.literal("string"),
                  required: z.literal(true),
                }),
              ),
              secrets: z
                .object({
                  codex_auth_json: z.object({ required: z.literal(true) }),
                })
                .strict(),
            })
            .strict(),
        })
        .strict(),
    })
    .parse(parsed.toJS());
  const keys = Object.keys(workflow.on.workflow_call.inputs).sort();
  if (
    JSON.stringify(keys) !==
    JSON.stringify([
      "migration_id",
      "provider_instance_id",
      "setup_base_url",
      "source_namespace_epoch",
      "source_namespace_id",
    ])
  ) {
    throw new Error("codex_runtime_migration_target_unavailable");
  }
}

export async function readImmutableTargetWorkflow(
  sha: string,
): Promise<string> {
  const response = await fetch(
    `https://raw.githubusercontent.com/777genius/review-router/${sha}/${codexRuntimeMigrationWorkflowPath}`,
    {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok)
    throw new Error("codex_runtime_migration_target_unavailable");
  const source = await response.text();
  if (Buffer.byteLength(source) > 64 * 1024)
    throw new Error("codex_runtime_migration_target_unavailable");
  return source;
}

const qualifiedImmutableMigrationTargets = new Set<string>();

/** Source bytes are immutable; qualification of the live registered tuple stays per-read. */
export async function inspectConfiguredRuntimeMigrationTarget(
  sha: string,
): Promise<boolean> {
  try {
    const installer = resolveCodexRotatingSeedScriptDescriptor();
    if (
      !/^[a-f0-9]{40}$/u.test(sha) ||
      installer.url !==
        `https://raw.githubusercontent.com/777genius/review-router/${sha}/scripts/seed-codex-rotating-auth.sh`
    )
      return false;
    if (qualifiedImmutableMigrationTargets.has(sha)) return true;
    assertCodexRuntimeMigrationTargetWorkflow(
      await readImmutableTargetWorkflow(sha),
    );
    if (qualifiedImmutableMigrationTargets.size >= 8)
      qualifiedImmutableMigrationTargets.clear();
    qualifiedImmutableMigrationTargets.add(sha);
    return true;
  } catch {
    return false;
  }
}
