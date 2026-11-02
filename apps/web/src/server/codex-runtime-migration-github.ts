import { createHash } from "node:crypto";
import {
  codexRuntimeMigrationBindingSchema,
  codexRuntimeMigrationRunName,
  codexRuntimeMigrationWorkflowPath,
  renderCodexRuntimeMigrationWorkflow,
  type CodexRuntimeMigrationBinding,
} from "@reviewrouter/features-provider-setup";
import { z } from "zod";
import { readCanonicalCodexRotatingT0WorkflowSourceMetadata } from "@reviewrouter/features-workflow-provisioning";

/** Repository-scoped, one-shot requests. The adapter never retries mutations. */
export type CodexRuntimeMigrationGitHubRequest = (
  method: "GET" | "PUT" | "POST",
  path: string,
  body?: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

const gitSha = z.string().regex(/^[a-f0-9]{40}$/u);
const positiveId = z.number().int().positive().safe();
const workflowSchema = z.object({
  id: positiveId,
  path: z.string(),
  state: z.string(),
});
const runSchema = z.object({
  id: positiveId,
  workflow_id: positiveId,
  path: z.string(),
  status: z.string(),
  run_attempt: z.number().int().positive(),
  head_sha: gitSha,
  head_branch: z.string().nullable(),
  event: z.string(),
  display_title: z.string(),
});

export class CodexRuntimeMigrationGitHub {
  private readonly repositoryPath: string;

  constructor(
    private readonly input: {
      readonly repositoryFullName: string;
      readonly githubRepositoryId: string;
      readonly providerInstanceId: string;
      readonly setupBaseUrl: string;
      readonly request: CodexRuntimeMigrationGitHubRequest;
    },
  ) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(input.repositoryFullName)) {
      throw new Error("codex_runtime_migration_repository_invalid");
    }
    this.repositoryPath = `/repos/${input.repositoryFullName.split("/").map(encodeURIComponent).join("/")}`;
  }

  async bootstrapInstalled(input: {
    readonly defaultBranch: string;
    readonly expectedSource: string;
  }): Promise<boolean> {
    const head = await this.currentHead(input.defaultBranch);
    try {
      const source = await this.readFile(
        codexRuntimeMigrationWorkflowPath,
        head,
      );
      if (source.content !== input.expectedSource) {
        throw new Error("codex_runtime_migration_bootstrap_source_mismatch");
      }
      return true;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 404
      )
        return false;
      throw error;
    }
  }

  /** Read-only qualification; source/target facts come from trusted server data. */
  async captureBinding(input: {
    readonly migrationId: string;
    readonly source: CodexRuntimeMigrationBinding["source"];
    readonly targetActionRef: string;
    readonly defaultBranch: string;
  }): Promise<CodexRuntimeMigrationBinding> {
    const head = await this.currentHead(input.defaultBranch);
    const workflows = await this.workflows();
    const bootstrap = uniqueWorkflow(
      workflows,
      codexRuntimeMigrationWorkflowPath,
    );
    if (bootstrap.state !== "active") {
      throw new Error("codex_runtime_migration_bootstrap_not_ready");
    }
    const bootstrapSource = await this.readFile(
      codexRuntimeMigrationWorkflowPath,
      head,
    );
    const expected = renderCodexRuntimeMigrationWorkflow({
      targetActionRef: input.targetActionRef,
      setupBaseUrl: this.input.setupBaseUrl,
      providerInstanceId: this.input.providerInstanceId,
      sourceNamespaceId: input.source.namespaceId,
      sourceNamespaceEpoch: input.source.namespaceEpoch,
      sourceSecretName: input.source.secretName,
    });
    if (bootstrapSource.content !== expected) {
      throw new Error("codex_runtime_migration_bootstrap_source_mismatch");
    }
    const ingress: CodexRuntimeMigrationBinding["ingress"] = [];
    for (const workflowPath of [
      ".github/workflows/reviewrouter-codex.yml",
      ".github/workflows/reviewrouter-interaction.yml",
    ] as const) {
      const matches = workflows.filter(
        (workflow) => workflow.path === workflowPath,
      );
      if (matches.length === 0 && workflowPath !== input.source.workflowPath) {
        // Missing indexing is not proof that a newly committed ingress cannot run.
        let absent = false;
        try {
          await this.readFile(workflowPath, head);
        } catch (error) {
          absent =
            !!error &&
            typeof error === "object" &&
            "status" in error &&
            error.status === 404;
          if (!absent) throw error;
        }
        if (!absent)
          throw new Error("codex_runtime_migration_inventory_incomplete");
        continue;
      }
      const workflow = uniqueWorkflow(workflows, workflowPath);
      const source = await this.readFile(workflowPath, head);
      ingress.push({
        workflowId: String(workflow.id),
        workflowPath,
        sourceBlobSha: source.blobSha,
        sourceSha256: source.sha256,
      });
    }
    return codexRuntimeMigrationBindingSchema.parse({
      version: 1,
      migrationId: input.migrationId,
      source: input.source,
      targetActionRef: input.targetActionRef,
      defaultBranch: input.defaultBranch,
      bootstrap: {
        workflowId: String(bootstrap.id),
        sourceCommitSha: head,
        sourceBlobSha: bootstrapSource.blobSha,
        sourceSha256: bootstrapSource.sha256,
      },
      ingress,
    });
  }

  async disableIngress(binding: CodexRuntimeMigrationBinding): Promise<void> {
    await this.assertSource(binding);
    for (const ingress of binding.ingress) {
      const before = await this.workflow(
        ingress.workflowId,
        ingress.workflowPath,
      );
      if (before.state === "disabled_manually") continue;
      if (before.state !== "active") {
        throw new Error("codex_runtime_migration_ingress_state_unknown");
      }
      try {
        await this.input.request(
          "PUT",
          `${this.repositoryPath}/actions/workflows/${ingress.workflowId}/disable`,
        );
      } catch {
        // A lost mutation acknowledgement is reconciled against exact state.
      }
      const after = await this.workflow(
        ingress.workflowId,
        ingress.workflowPath,
      );
      if (after.state !== "disabled_manually") {
        throw new Error("codex_runtime_migration_disable_unconfirmed");
      }
    }
  }

  /** Full pagination, before/after source checks; unknown status never means drained. */
  async assertDrained(binding: CodexRuntimeMigrationBinding): Promise<void> {
    await this.assertSource(binding);
    const actual = await this.workflows();
    const paths = new Set(binding.ingress.map((entry) => entry.workflowPath));
    for (const workflow of actual) {
      if (
        (workflow.path === ".github/workflows/reviewrouter-codex.yml" ||
          workflow.path === ".github/workflows/reviewrouter-interaction.yml") &&
        !paths.has(workflow.path)
      ) {
        throw new Error("codex_runtime_migration_ingress_changed");
      }
    }
    for (const ingress of binding.ingress) {
      const workflow = uniqueWorkflow(actual, ingress.workflowPath);
      if (
        String(workflow.id) !== ingress.workflowId ||
        workflow.state !== "disabled_manually"
      ) {
        throw new Error("codex_runtime_migration_ingress_not_disabled");
      }
      const runs = await this.runs(ingress.workflowId);
      if (
        runs.some(
          (run) =>
            run.status !== "completed" ||
            run.workflow_id !== workflow.id ||
            normalizeRunPath(run.path) !== ingress.workflowPath,
        )
      ) {
        throw new Error("codex_runtime_migration_runs_not_drained");
      }
    }
    await this.assertSource(binding);
    for (const ingress of binding.ingress) {
      if (
        (await this.workflow(ingress.workflowId, ingress.workflowPath))
          .state !== "disabled_manually"
      ) {
        throw new Error("codex_runtime_migration_ingress_not_disabled");
      }
    }
  }

  /** Existence of the setup manifest is the durable one-dispatch admission. */
  async dispatch(
    binding: CodexRuntimeMigrationBinding,
    admission: "fresh" | "readback_only",
  ): Promise<
    | { readonly status: "observed" | "finished"; readonly runId: string }
    | { readonly status: "dispatch_unconfirmed" }
  > {
    const existing = await this.findMigrationRun(binding);
    if (existing) return observedDispatch(existing);
    if (admission === "fresh") {
      await this.assertDrained(binding);
      try {
        await this.input.request(
          "POST",
          `${this.repositoryPath}/actions/workflows/${binding.bootstrap.workflowId}/dispatches`,
          {
            ref: binding.defaultBranch,
            inputs: { migration_id: binding.migrationId },
          },
        );
      } catch {
        // Readback below is the only follow-up. Never dispatch again on replay.
      }
    }
    const observed = await this.findMigrationRun(binding);
    return observed
      ? observedDispatch(observed)
      : { status: "dispatch_unconfirmed" };
  }

  async assertRunner(
    binding: CodexRuntimeMigrationBinding,
    runId: string,
    runAttempt: string,
  ): Promise<void> {
    if (!/^[1-9][0-9]*$/u.test(runId) || runAttempt !== "1") {
      throw new Error("codex_runtime_migration_runner_mismatch");
    }
    const run = runSchema.parse(
      await this.input.request(
        "GET",
        `${this.repositoryPath}/actions/runs/${runId}`,
      ),
    );
    if (
      String(run.id) !== runId ||
      run.run_attempt !== 1 ||
      run.status !== "in_progress" ||
      !this.matchesRun(binding, run)
    ) {
      throw new Error("codex_runtime_migration_runner_mismatch");
    }
    await this.assertDrained(binding);
  }

  /** Called only after the existing namespace activation committed. */
  async enableActivatedIngress(input: {
    readonly binding: CodexRuntimeMigrationBinding;
    readonly reviewSourceSha256: string;
    readonly interactionSources: readonly string[];
  }): Promise<void> {
    const head = await this.currentHead(input.binding.defaultBranch);
    let bootstrapRemoved = false;
    try {
      await this.readFile(codexRuntimeMigrationWorkflowPath, head);
    } catch (error) {
      bootstrapRemoved =
        !!error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 404;
      if (!bootstrapRemoved) throw error;
    }
    if (!bootstrapRemoved)
      throw new Error("codex_runtime_migration_bootstrap_cleanup_required");
    const workflows = await this.workflows();
    for (const ingress of input.binding.ingress) {
      const source = await this.readFile(ingress.workflowPath, head);
      if (
        ingress.workflowPath === ".github/workflows/reviewrouter-codex.yml"
          ? source.sha256 !== input.reviewSourceSha256 ||
            readCanonicalCodexRotatingT0WorkflowSourceMetadata(source.content)
              .actionRef !== input.binding.targetActionRef
          : !input.interactionSources.includes(source.content)
      ) {
        throw new Error("codex_runtime_migration_source_changed");
      }
      const workflow = uniqueWorkflow(workflows, ingress.workflowPath);
      if (
        String(workflow.id) !== ingress.workflowId ||
        !["active", "disabled_manually"].includes(workflow.state)
      ) {
        throw new Error("codex_runtime_migration_ingress_state_unknown");
      }
      if (workflow.state === "active") continue;
      if ((await this.currentHead(input.binding.defaultBranch)) !== head)
        throw new Error("codex_runtime_migration_source_changed");
      try {
        await this.input.request(
          "PUT",
          `${this.repositoryPath}/actions/workflows/${ingress.workflowId}/enable`,
        );
      } catch {
        // Exact state, rather than a mutation acknowledgement, decides completion.
      }
      if (
        (await this.workflow(ingress.workflowId, ingress.workflowPath))
          .state !== "active"
      ) {
        throw new Error("codex_runtime_migration_enable_unconfirmed");
      }
    }
  }

  private async findMigrationRun(binding: CodexRuntimeMigrationBinding) {
    const matches = (await this.runs(binding.bootstrap.workflowId)).filter(
      (run) =>
        run.display_title === codexRuntimeMigrationRunName(binding.migrationId),
    );
    if (
      matches.length > 1 ||
      matches.some((run) => !this.matchesRun(binding, run))
    ) {
      throw new Error("codex_runtime_migration_dispatch_ambiguous");
    }
    return matches[0] ?? null;
  }

  private matchesRun(
    binding: CodexRuntimeMigrationBinding,
    run: z.infer<typeof runSchema>,
  ): boolean {
    return (
      String(run.workflow_id) === binding.bootstrap.workflowId &&
      run.event === "workflow_dispatch" &&
      normalizeRunPath(run.path) === codexRuntimeMigrationWorkflowPath &&
      run.head_sha === binding.bootstrap.sourceCommitSha &&
      run.head_branch === binding.defaultBranch &&
      run.display_title === codexRuntimeMigrationRunName(binding.migrationId)
    );
  }

  private async assertSource(
    binding: CodexRuntimeMigrationBinding,
  ): Promise<void> {
    if (
      (await this.currentHead(binding.defaultBranch)) !==
      binding.bootstrap.sourceCommitSha
    ) {
      throw new Error("codex_runtime_migration_source_changed");
    }
    for (const expected of [
      {
        workflowPath: codexRuntimeMigrationWorkflowPath,
        sourceBlobSha: binding.bootstrap.sourceBlobSha,
        sourceSha256: binding.bootstrap.sourceSha256,
      },
      ...binding.ingress,
    ]) {
      const actual = await this.readFile(
        expected.workflowPath,
        binding.bootstrap.sourceCommitSha,
      );
      if (
        actual.blobSha !== expected.sourceBlobSha ||
        actual.sha256 !== expected.sourceSha256
      ) {
        throw new Error("codex_runtime_migration_source_changed");
      }
    }
  }

  private async currentHead(defaultBranch: string): Promise<string> {
    const repository = z
      .object({
        id: positiveId,
        full_name: z.string(),
        default_branch: z.string(),
      })
      .parse(await this.input.request("GET", this.repositoryPath));
    if (
      String(repository.id) !== this.input.githubRepositoryId ||
      repository.full_name !== this.input.repositoryFullName ||
      repository.default_branch !== defaultBranch
    ) {
      throw new Error("codex_runtime_migration_repository_changed");
    }
    return z
      .object({ object: z.object({ sha: gitSha }) })
      .parse(
        await this.input.request(
          "GET",
          `${this.repositoryPath}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
        ),
      ).object.sha;
  }

  private async readFile(path: string, ref: string) {
    const result = z
      .object({
        type: z.literal("file"),
        sha: gitSha,
        encoding: z.literal("base64"),
        content: z.string().max(128 * 1024),
      })
      .parse(
        await this.input.request(
          "GET",
          `${this.repositoryPath}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
        ),
      );
    const content = Buffer.from(result.content, "base64").toString("utf8");
    if (Buffer.byteLength(content) > 64 * 1024)
      throw new Error("codex_runtime_migration_source_too_large");
    return {
      content,
      blobSha: result.sha,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  }

  private async workflow(id: string, path: string) {
    const result = workflowSchema.parse(
      await this.input.request(
        "GET",
        `${this.repositoryPath}/actions/workflows/${id}`,
      ),
    );
    if (String(result.id) !== id || result.path !== path)
      throw new Error("codex_runtime_migration_ingress_changed");
    return result;
  }

  private workflows() {
    return this.inventory(
      `${this.repositoryPath}/actions/workflows`,
      "workflows",
      workflowSchema,
    );
  }

  private runs(workflowId: string) {
    return this.inventory(
      `${this.repositoryPath}/actions/workflows/${workflowId}/runs`,
      "workflow_runs",
      runSchema,
    );
  }

  private async inventory<T extends { readonly id: number }>(
    path: string,
    key: string,
    schema: z.ZodType<T>,
  ): Promise<T[]> {
    const result: T[] = [];
    let total: number | undefined;
    // A bounded incomplete inventory is unavailable, never a drain witness.
    for (let page = 1; page <= 100; page += 1) {
      const body = z
        .record(z.string(), z.unknown())
        .parse(
          await this.input.request("GET", `${path}?per_page=100&page=${page}`),
        );
      const count = z
        .number()
        .int()
        .nonnegative()
        .safe()
        .parse(body.total_count);
      if (total !== undefined && count !== total)
        throw new Error("codex_runtime_migration_inventory_changed");
      total = count;
      const rows = z.array(schema).max(100).parse(body[key]);
      result.push(...rows);
      if (
        new Set(result.map((row) => row.id)).size !== result.length ||
        result.length > total
      ) {
        throw new Error("codex_runtime_migration_inventory_incomplete");
      }
      if (rows.length < 100) {
        if (result.length !== total)
          throw new Error("codex_runtime_migration_inventory_incomplete");
        return result;
      }
    }
    throw new Error("codex_runtime_migration_inventory_incomplete");
  }
}

function uniqueWorkflow(
  workflows: readonly z.infer<typeof workflowSchema>[],
  path: string,
) {
  const matches = workflows.filter((entry) => entry.path === path);
  if (matches.length !== 1)
    throw new Error("codex_runtime_migration_workflow_missing_or_ambiguous");
  return matches[0]!;
}

function normalizeRunPath(path: string): string {
  return path.split("@")[0]!;
}

function observedDispatch(run: z.infer<typeof runSchema>) {
  if (run.status === "completed")
    return { status: "finished" as const, runId: String(run.id) };
  if (
    !["queued", "requested", "waiting", "pending", "in_progress"].includes(
      run.status,
    )
  ) {
    return { status: "dispatch_unconfirmed" as const };
  }
  return { status: "observed" as const, runId: String(run.id) };
}
