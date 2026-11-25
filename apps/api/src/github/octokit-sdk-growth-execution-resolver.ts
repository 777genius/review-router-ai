import { App } from "@octokit/app";
import { AuthorityError } from "@reviewrouter/features-sdk-growth-authority";
import type {
  ResolvedSdkGrowthExecution,
  SdkGrowthExecutionResolverPort,
} from "../sdk-growth-authority-routes.js";

type Requester = {
  request(
    route: string,
    parameters?: Record<string, unknown>,
  ): Promise<{ data: unknown }>;
};
type InstallationApp = {
  getInstallationOctokit(id: number): Promise<Requester> | Requester;
};
type Selection = {
  number: number;
  headRepositoryId: string;
  headSha: string;
  baseRepositoryId: string;
  baseRef: string;
  baseSha: string;
};
type Run = {
  headSha: string;
  workflowId: number;
  workflowPath: string;
  event: string;
};

export class OctokitSdkGrowthExecutionResolver implements SdkGrowthExecutionResolverPort {
  private readonly app: InstallationApp;

  constructor(input: {
    readonly appId?: string;
    readonly privateKey?: string;
    readonly app?: InstallationApp;
  }) {
    if (!input.app && (!input.appId || !input.privateKey))
      throw new Error("sdk_growth_github_app_unavailable");
    this.app =
      input.app ??
      new App({ appId: input.appId!, privateKey: input.privateKey! });
  }

  async resolve(input: {
    readonly installationId: string;
    readonly githubRepositoryId: string;
    readonly repositoryFullName: string;
    readonly runId: string;
    readonly runAttempt: string;
    readonly verifierRevision: string;
    readonly pullRequest: number;
    readonly workflowRef: string;
  }): Promise<ResolvedSdkGrowthExecution | null> {
    const installationId = integer(input.installationId);
    const repositoryId = integer(input.githubRepositoryId);
    const runId = integer(input.runId);
    const runAttempt = integer(input.runAttempt);
    if (
      !Number.isSafeInteger(input.pullRequest) ||
      input.pullRequest < 1 ||
      !sha(input.verifierRevision)
    )
      throw new AuthorityError("wrong-identity");
    const [owner, repo, extra] = input.repositoryFullName.split("/");
    if (
      !owner ||
      !repo ||
      extra ||
      !/^[A-Za-z0-9_.-]+$/.test(owner) ||
      !/^[A-Za-z0-9_.-]+$/.test(repo)
    )
      throw new AuthorityError("wrong-identity");
    const workflowPrefix = `${input.repositoryFullName}/`;
    if (
      !input.workflowRef.startsWith(workflowPrefix) ||
      !input.workflowRef
        .slice(workflowPrefix.length)
        .startsWith(".github/workflows/") ||
      !input.workflowRef.includes("@refs/")
    )
      throw new AuthorityError("wrong-identity");
    const client = await this.app.getInstallationOctokit(installationId);
    const params = { owner, repo, request: { timeout: 10_000 } };
    if (
      !(await selectedRepository(
        client,
        params,
        repositoryId,
        input.repositoryFullName,
      ))
    )
      return null;
    const before = await pull(
      client,
      params,
      input.pullRequest,
      input.githubRepositoryId,
    );
    // A fork needs independent proof that this installation can own/read the
    // head object. This first mode deliberately holds fork PRs until that proof
    // is available; a route name or head.repo field is not proof.
    if (!before || before.headRepositoryId !== input.githubRepositoryId)
      return null;
    const run = await readRun(client, params, runId, runAttempt, input, before);
    if (!run) return null;

    const comparison = record(
      (
        await client.request("GET /repos/{owner}/{repo}/compare/{basehead}", {
          ...params,
          basehead: `${before.baseSha}...${before.headSha}`,
        })
      ).data,
    );
    const mergeBase = record(comparison.merge_base_commit);
    if (!sha(mergeBase.sha)) return null;
    // The REST compare API's singular merge_base_commit does not prove a
    // unique base for a diverged graph. Base-ancestor-of-head is unambiguous.
    // Behind-only, identical and diverged graphs remain HOLD here.
    if (
      mergeBase.sha !== before.baseSha ||
      comparison.status !== "ahead" ||
      typeof comparison.ahead_by !== "number" ||
      !Number.isSafeInteger(comparison.ahead_by) ||
      comparison.ahead_by < 1
    )
      return null;
    const [headTree, baseTree, mergeBaseTree] = await Promise.all([
      tree(client, params, before.headSha),
      tree(client, params, before.baseSha),
      tree(client, params, mergeBase.sha),
    ]);
    if (!headTree || !baseTree || !mergeBaseTree) return null;
    const after = await pull(
      client,
      params,
      input.pullRequest,
      input.githubRepositoryId,
    );
    if (
      !after ||
      !sameSelection(before, after) ||
      !(await selectedRepository(
        client,
        params,
        repositoryId,
        input.repositoryFullName,
      )) ||
      !(await readRun(client, params, runId, runAttempt, input, after, run))
    )
      return null;
    return {
      installationId: input.installationId,
      runId: input.runId,
      runAttempt: input.runAttempt,
      verifierRevision: input.verifierRevision,
      pullRequest: input.pullRequest,
      headRepositoryId: before.headRepositoryId,
      baseRepositoryId: before.baseRepositoryId,
      baseRef: before.baseRef,
      sourceCommit: before.headSha,
      sourceTree: headTree,
      baseCommit: before.baseSha,
      baseTree,
      mergeBaseCommit: mergeBase.sha,
      mergeBaseTree,
    };
  }

  /** Historical bridge-v1 run SHA/tree is usable only for GET readback. */
  async resolveHistorical(input: {
    readonly installationId: string;
    readonly githubRepositoryId: string;
    readonly repositoryFullName: string;
    readonly runId: string;
    readonly runAttempt: string;
    readonly verifierRevision: string;
    readonly pullRequest: number;
    readonly workflowRef: string;
  }) {
    const installationId = integer(input.installationId);
    const repositoryId = integer(input.githubRepositoryId);
    const runId = integer(input.runId);
    const runAttempt = integer(input.runAttempt);
    if (
      !Number.isSafeInteger(input.pullRequest) ||
      input.pullRequest < 1 ||
      !sha(input.verifierRevision)
    )
      throw new AuthorityError("wrong-identity");
    const [owner, repo, extra] = input.repositoryFullName.split("/");
    if (
      !owner ||
      !repo ||
      extra ||
      !/^[A-Za-z0-9_.-]+$/.test(owner) ||
      !/^[A-Za-z0-9_.-]+$/.test(repo) ||
      !input.workflowRef.startsWith(
        `${input.repositoryFullName}/.github/workflows/`,
      ) ||
      !input.workflowRef.includes("@refs/")
    )
      throw new AuthorityError("wrong-identity");
    const client = await this.app.getInstallationOctokit(installationId);
    const params = { owner, repo, request: { timeout: 10_000 } };
    if (
      !(await selectedRepository(
        client,
        params,
        repositoryId,
        input.repositoryFullName,
      ))
    )
      return null;
    const run = await readRun(client, params, runId, runAttempt, input);
    if (!run) return null;
    const sourceTree = await tree(client, params, run.headSha);
    if (
      !sourceTree ||
      !(await selectedRepository(
        client,
        params,
        repositoryId,
        input.repositoryFullName,
      )) ||
      !(await readRun(client, params, runId, runAttempt, input, undefined, run))
    )
      return null;
    return {
      installationId: input.installationId,
      runId: input.runId,
      runAttempt: input.runAttempt,
      verifierRevision: input.verifierRevision,
      pullRequest: input.pullRequest,
      sourceCommit: run.headSha,
      sourceTree,
    };
  }
}

async function selectedRepository(
  client: Requester,
  params: Record<string, unknown>,
  id: number,
  fullName: string,
): Promise<boolean> {
  const repository = record(
    (await client.request("GET /repos/{owner}/{repo}", params)).data,
  );
  return (
    repository.id === id &&
    String(repository.full_name).toLowerCase() === fullName.toLowerCase()
  );
}

async function pull(
  client: Requester,
  params: Record<string, unknown>,
  number: number,
  repositoryId: string,
): Promise<Selection | null> {
  const value = record(
    (
      await client.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        ...params,
        pull_number: number,
      })
    ).data,
  );
  if (value.number !== number || value.state !== "open") return null;
  const head = record(value.head);
  const base = record(value.base);
  // GitHub can retain a closed PR after deleting its fork. An absent fork
  // cannot qualify current v2 capture; historical GET verifies the run alone.
  if (head.repo === null) return null;
  const headRepository = record(head.repo);
  const baseRepository = record(base.repo);
  if (
    String(baseRepository.id) !== repositoryId ||
    !sha(head.sha) ||
    !sha(base.sha) ||
    typeof base.ref !== "string" ||
    !base.ref ||
    !Number.isSafeInteger(headRepository.id) ||
    !Number.isSafeInteger(baseRepository.id)
  )
    return null;
  return {
    number,
    headRepositoryId: String(headRepository.id),
    headSha: head.sha,
    baseRepositoryId: String(baseRepository.id),
    baseRef: base.ref,
    baseSha: base.sha,
  };
}

function sameSelection(left: Selection, right: Selection): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function readRun(
  client: Requester,
  params: Record<string, unknown>,
  id: number,
  attempt: number,
  input: {
    readonly githubRepositoryId: string;
    readonly repositoryFullName: string;
    readonly pullRequest: number;
    readonly workflowRef: string;
  },
  selection?: Selection,
  prior?: Run,
): Promise<Run | null> {
  const value = record(
    (
      await client.request("GET /repos/{owner}/{repo}/actions/runs/{run_id}", {
        ...params,
        run_id: id,
      })
    ).data,
  );
  const repository = record(value.repository);
  const associated = value.pull_requests;
  const expectedPath = input.workflowRef
    .slice(input.repositoryFullName.length + 1)
    .split("@")[0];
  const headSha = value.head_sha;
  const workflowPath = value.path;
  const workflowId = value.workflow_id;
  const event = value.event;
  // Closed runs can lose their pull_requests association. Only historical
  // GET allows an empty list, because the verified OIDC ref names this PR;
  // a populated list must name exactly one matching PR.
  if (
    value.id !== id ||
    value.run_attempt !== attempt ||
    String(repository.id) !== input.githubRepositoryId ||
    String(repository.full_name).toLowerCase() !==
      input.repositoryFullName.toLowerCase() ||
    !sha(headSha) ||
    event !== "pull_request" ||
    typeof workflowPath !== "string" ||
    workflowPath.split("@")[0] !== expectedPath ||
    !Number.isSafeInteger(workflowId) ||
    Number(workflowId) < 1 ||
    !Array.isArray(associated) ||
    associated.length > 1 ||
    (selection && associated.length !== 1) ||
    (associated.length === 1 &&
      !associated.some((item: unknown) => {
        const entry = record(item);
        return (
          entry.number === input.pullRequest &&
          (!selection ||
            (record(entry.head).sha === selection.headSha &&
              record(entry.base).sha === selection.baseSha))
        );
      }))
  )
    return null;
  // pull_request run.head_sha may be a synthetic merge commit. Never use it
  // as candidate identity: only the independently read PR head is eligible.
  const result: Run = {
    headSha,
    workflowId: Number(workflowId),
    workflowPath,
    event,
  };
  return prior && JSON.stringify(prior) !== JSON.stringify(result)
    ? null
    : result;
}

async function tree(
  client: Requester,
  params: Record<string, unknown>,
  commitSha: string,
): Promise<string | null> {
  const value = record(
    (
      await client.request(
        "GET /repos/{owner}/{repo}/git/commits/{commit_sha}",
        {
          ...params,
          commit_sha: commitSha,
        },
      )
    ).data,
  );
  const treeValue = record(value.tree);
  return value.sha === commitSha && sha(treeValue.sha) ? treeValue.sha : null;
}

function integer(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw new AuthorityError("wrong-identity");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new AuthorityError("wrong-identity");
  return parsed;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AuthorityError("binding-changed");
  return value as Record<string, unknown>;
}

function sha(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}
