import { createHash } from "node:crypto";
import {
  allocateVersionedProviderSecretNamespace,
  codexRuntimeMigrationRunName,
  codexRuntimeMigrationWorkflowPath,
  renderCodexRuntimeMigrationWorkflow,
} from "@reviewrouter/features-provider-setup";
import {
  CodexRotatingReviewActionV2Mode,
  renderCodexRotatingAdvisoryWorkflow,
} from "@reviewrouter/features-workflow-provisioning";
import {
  CodexRuntimeMigrationGitHub,
  type CodexRuntimeMigrationGitHubRequest,
} from "../codex-runtime-migration-github";

export function codexRuntimeMigrationFixture(
  options: {
    readonly repositoryId?: string;
    readonly namespace?: ReturnType<
      typeof allocateVersionedProviderSecretNamespace
    >;
  } = {},
) {
  const repositoryId = options.repositoryId ?? "1228051727";
  const providerInstanceId = `codex-rotating:${repositoryId}`;
  const scope = { repositoryId, providerInstanceId };
  const namespace =
    options.namespace ??
    allocateVersionedProviderSecretNamespace({
      scope,
      epoch: 3,
      randomBytes: () => new Uint8Array(16).fill(1),
    });
  const targetNamespace = allocateVersionedProviderSecretNamespace({
    scope,
    epoch: namespace.epoch + 1n,
    randomBytes: () => new Uint8Array(16).fill(2),
  });
  const oldActionRef = `777genius/review-router@${"a".repeat(40)}`;
  const targetActionRef = `777genius/review-router@${"b".repeat(40)}`;
  const head = "c".repeat(40);
  const migrationId = "codex_migration_11111111-1111-4111-8111-111111111111";
  const repositoryFullName = "777genius/review-router-saas-e2e";
  const setupBaseUrl = "https://reviewrouter.test";
  const apiUrl = "https://api.reviewrouter.test";
  const renderReview = (target = false) =>
    renderCodexRotatingAdvisoryWorkflow({
      actionRef: target ? targetActionRef : oldActionRef,
      apiUrl,
      providerInstanceId,
      workflowSchemaVersion: 5,
      reviewActionV2Mode: CodexRotatingReviewActionV2Mode.T0,
      activeSecretNamespace: target ? targetNamespace : namespace,
    });
  const sourceText = renderReview();
  const bootstrap = renderCodexRuntimeMigrationWorkflow({
    targetActionRef,
    setupBaseUrl,
    providerInstanceId,
    sourceNamespaceId: namespace.namespaceId,
    sourceNamespaceEpoch: namespace.epoch.toString(),
    sourceSecretName: namespace.name,
  });
  const source = {
    namespaceId: namespace.namespaceId,
    namespaceEpoch: namespace.epoch.toString(),
    secretName: namespace.name,
    canonicalizationVersion: 1 as const,
    mutationEpoch: "8",
    generation: 5,
    generationHash: "g".repeat(43),
    accountIdentityHash: "h".repeat(43),
    generationHashSalt: "s".repeat(43),
    accountFingerprintSalt: "t".repeat(43),
    actionRef: oldActionRef,
    workflowPath: ".github/workflows/reviewrouter-codex.yml" as const,
    workflowSourceCommitSha: "d".repeat(40),
    workflowSourceBlobSha: blob(sourceText),
    workflowSourceSha256: digest(sourceText),
    workflowSemanticSha256: "e".repeat(64),
    workflowSchemaVersion: 5 as const,
  };
  const files = new Map<string, string>([
    [source.workflowPath, sourceText],
    [codexRuntimeMigrationWorkflowPath, bootstrap],
  ]);
  const workflows = [
    { id: 100, path: source.workflowPath, state: "active" },
    { id: 200, path: codexRuntimeMigrationWorkflowPath, state: "active" },
  ];
  const oldRun = (id: number, status = "completed") => ({
    id,
    workflow_id: 100,
    path: source.workflowPath,
    status,
    run_attempt: 1,
    head_sha: head,
    head_branch: "main",
    event: "pull_request_target",
    display_title: `Review ${id}`,
  });
  const bootstrapRun = (id = 500) => ({
    id,
    workflow_id: 200,
    path: codexRuntimeMigrationWorkflowPath,
    status: "in_progress",
    run_attempt: 1,
    head_sha: head,
    head_branch: "main",
    event: "workflow_dispatch",
    display_title: codexRuntimeMigrationRunName(migrationId),
  });
  const runs = new Map<
    number,
    (ReturnType<typeof oldRun> | ReturnType<typeof bootstrapRun>)[]
  >([
    [100, [oldRun(1)]],
    [200, []],
  ]);
  const writes: {
    method: string;
    path: string;
    body?: Readonly<Record<string, unknown>>;
  }[] = [];
  const faults = {
    loseDisableAck: false,
    ignoreDisable: false,
    loseDispatchAck: false,
    createDispatchedRun: true,
    incompletePage: false,
    changedHead: false,
    loseEnableAck: false,
  };
  const request: CodexRuntimeMigrationGitHubRequest = async (
    method,
    path,
    body,
  ) => {
    const prefix = `/repos/${repositoryFullName}`;
    if (method !== "GET") {
      writes.push({ method, path, ...(body ? { body } : {}) });
      if (path.endsWith("/disable")) {
        if (!faults.ignoreDisable)
          workflows.find((item) =>
            path.includes(`/workflows/${item.id}/`),
          )!.state = "disabled_manually";
        if (faults.loseDisableAck)
          throw new Error("synthetic lost disable acknowledgement");
      } else if (path.endsWith("/enable")) {
        workflows.find((item) =>
          path.includes(`/workflows/${item.id}/`),
        )!.state = "active";
        if (faults.loseEnableAck)
          throw new Error("synthetic lost enable acknowledgement");
      } else if (path.endsWith("/dispatches")) {
        if (faults.createDispatchedRun) runs.get(200)!.push(bootstrapRun());
        if (faults.loseDispatchAck)
          throw new Error("synthetic lost dispatch acknowledgement");
      } else throw new Error(`unexpected synthetic mutation ${path}`);
      return null;
    }
    if (path === prefix)
      return {
        id: Number(repositoryId),
        full_name: repositoryFullName,
        default_branch: "main",
      };
    if (path.includes("/git/ref/heads/"))
      return { object: { sha: faults.changedHead ? "f".repeat(40) : head } };
    if (path.includes("/contents/")) {
      const name = decodeURIComponent(
        path.split("/contents/")[1]!.split("?")[0]!,
      );
      const content = files.get(name);
      if (content === undefined)
        throw Object.assign(new Error("synthetic missing file"), {
          status: 404,
        });
      return {
        type: "file",
        sha: blob(content),
        encoding: "base64",
        content: Buffer.from(content).toString("base64"),
      };
    }
    const listedRuns =
      /\/actions\/workflows\/(\d+)\/runs\?per_page=100&page=(\d+)/u.exec(path);
    if (listedRuns) {
      const all = runs.get(Number(listedRuns[1]))!;
      const page = Number(listedRuns[2]);
      return {
        total_count: all.length,
        workflow_runs: faults.incompletePage
          ? []
          : all.slice((page - 1) * 100, page * 100),
      };
    }
    if (path.includes("/actions/workflows?"))
      return { total_count: workflows.length, workflows };
    const workflow = /\/actions\/workflows\/(\d+)$/u.exec(path);
    if (workflow)
      return workflows.find((item) => item.id === Number(workflow[1]));
    const run = /\/actions\/runs\/(\d+)$/u.exec(path);
    if (run)
      return [...runs.values()]
        .flat()
        .find((item) => item.id === Number(run[1]));
    throw new Error(`unexpected synthetic read ${path}`);
  };
  const github = new CodexRuntimeMigrationGitHub({
    repositoryFullName,
    githubRepositoryId: repositoryId,
    providerInstanceId,
    setupBaseUrl,
    request,
  });
  return {
    repositoryId,
    providerInstanceId,
    repositoryFullName,
    namespace,
    targetNamespace,
    targetActionRef,
    oldActionRef,
    source,
    head,
    migrationId,
    setupBaseUrl,
    apiUrl,
    bootstrap,
    files,
    workflows,
    runs,
    writes,
    faults,
    github,
    oldRun,
    bootstrapRun,
    renderReview,
    capture: () =>
      github.captureBinding({
        migrationId,
        source,
        targetActionRef,
        defaultBranch: "main",
      }),
  };
}

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function blob(value: string): string {
  return createHash("sha1")
    .update(`blob ${Buffer.byteLength(value)}\0${value}`)
    .digest("hex");
}
