import { createHash } from "node:crypto";
import { SDK_GROWTH_RESERVED_CHECK_NAME } from "@reviewrouter/shared/scm";

export type SdkGrowthCheckSpec = Readonly<{
  repositoryId: string;
  installationId: string;
  appId: string;
  repositoryFullName: string;
  headSha: string;
  name: typeof SDK_GROWTH_RESERVED_CHECK_NAME;
  externalId: string;
  conclusion: "success" | "failure";
  output: Readonly<{ title: string; summary: string }>;
}>;

export type SdkGrowthObservation =
  | Readonly<{
      kind: "exact";
      checkRunId: string;
      observedDigest: string;
      at: number;
    }>
  | Readonly<{ kind: "absent"; at: number }>
  | Readonly<{
      kind: "unknown";
      reason:
        | "transport"
        | "partial-read"
        | "malformed-response"
        | "unavailable";
      at: number;
    }>
  | Readonly<{
      kind: "conflict";
      reason:
        | "duplicate"
        | "identity-mismatch"
        | "output-mismatch"
        | "unexpected-effect";
      witnessIds: readonly string[];
      evidenceDigest: string;
      at: number;
    }>;

export type SdkGrowthPostResult =
  | Readonly<{ kind: "acknowledged"; checkRunId: string }>
  | Readonly<{
      kind: "no-effect";
      reason: "local-pre-dispatch" | "provider-rejected";
      evidenceDigest: string;
      at: number;
    }>
  | Extract<SdkGrowthObservation, { kind: "unknown" }>;

export interface SdkGrowthGitHubRequestPort {
  auth(options: Readonly<{ type: "installation" }>): Promise<unknown>;
  request(
    route: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<{ data: unknown }>>;
  /** Authenticated transport with refresh/retry hooks disabled for mutations. */
  requestOnce?(
    route: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<{ data: unknown }>>;
}

export class SdkGrowthCheckGateway {
  private static readonly DEFAULT_REQUEST_DEADLINE_MS = 15_000;

  private readonly appId: string;
  private readonly installationId: string;
  private readonly repositoryId: string;
  private readonly owner: string;
  private readonly repo: string;

  constructor(
    private readonly client: SdkGrowthGitHubRequestPort,
    identity: Readonly<{
      appId: string;
      installationId: string;
      repositoryId: string;
      repositoryFullName: string;
    }>,
    private readonly now: () => number = Date.now,
    private readonly requestDeadlineMs = SdkGrowthCheckGateway.DEFAULT_REQUEST_DEADLINE_MS,
  ) {
    this.appId = safeNumericId(identity.appId, "sdk_growth_app_id_invalid");
    this.installationId = safeNumericId(
      identity.installationId,
      "sdk_growth_installation_id_invalid",
    );
    this.repositoryId = safeNumericId(
      identity.repositoryId,
      "sdk_growth_repository_id_invalid",
    );
    [this.owner, this.repo] = splitFullName(identity.repositoryFullName);
    if (
      !Number.isSafeInteger(this.requestDeadlineMs) ||
      this.requestDeadlineMs <= 0
    ) {
      throw new Error("sdk_growth_request_deadline_invalid");
    }
  }

  async inspect(
    spec: SdkGrowthCheckSpec,
    signal: AbortSignal,
  ): Promise<SdkGrowthObservation> {
    const requestSignal = boundedSignal(signal, this.requestDeadlineMs);
    try {
      this.assertSpec(spec);
      await this.assertProviderIdentity(requestSignal);
      const rows = await this.readAllCheckRuns(spec, requestSignal);
      return this.classify(rows, spec);
    } catch (error) {
      if (error instanceof ReadbackError) {
        return {
          kind: "unknown",
          reason: error.reason,
          at: this.now(),
        };
      }
      return { kind: "unknown", reason: "transport", at: this.now() };
    }
  }

  async create(
    spec: SdkGrowthCheckSpec,
    attemptId: string,
    signal: AbortSignal,
  ): Promise<SdkGrowthPostResult> {
    const requestSignal = boundedSignal(signal, this.requestDeadlineMs);
    let dispatchStarted = false;
    try {
      this.assertSpec(spec);
      if (!attemptId || attemptId.length > 256) {
        throw new Error("sdk_growth_attempt_id_invalid");
      }
      const authentication = await this.assertProviderIdentity(requestSignal);
      // Octokit's App auth hook retries fresh-token 401s independently of
      // request.retries. Supply the verified token and bypass hooks for POST.
      const oneShotOptions = this.client.requestOnce
        ? {}
        : {
            headers: {
              authorization: `token ${installationToken(authentication)}`,
            },
            request: { signal: requestSignal, retries: 0, hook: null },
          };
      requestSignal.throwIfAborted();
      dispatchStarted = true;
      const response = await this.request(
        "POST /repos/{owner}/{repo}/check-runs",
        {
          owner: this.owner,
          repo: this.repo,
          name: spec.name,
          head_sha: spec.headSha,
          external_id: spec.externalId,
          status: "completed",
          conclusion: spec.conclusion,
          output: spec.output,
          request: { signal: requestSignal, retries: 0 },
          ...oneShotOptions,
        },
      );
      const row = record(response.data);
      return {
        kind: "acknowledged",
        checkRunId: observedNumericId(row.id, "sdk_growth_check_id_invalid"),
      };
    } catch (error) {
      const status = httpStatus(error);
      if (dispatchStarted && isDefiniteProviderRejection(status)) {
        return {
          kind: "no-effect",
          reason: "provider-rejected",
          evidenceDigest: digestEvidence({
            kind: "provider-rejected",
            status,
          }),
          at: this.now(),
        };
      }
      if (requestSignal.aborted) {
        return { kind: "unknown", reason: "transport", at: this.now() };
      }
      if (!dispatchStarted) {
        return {
          kind: "no-effect",
          reason: "local-pre-dispatch",
          evidenceDigest: digestEvidence({ kind: "local-pre-dispatch" }),
          at: this.now(),
        };
      }
      return { kind: "unknown", reason: "transport", at: this.now() };
    }
  }

  private request(
    route: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<{ data: unknown }>> {
    const options = parameters.request as { signal: AbortSignal };
    options.signal.throwIfAborted();
    const request =
      route.startsWith("POST ") && this.client.requestOnce
        ? this.client.requestOnce
        : this.client.request;
    return awaitWithSignal(
      request.call(this.client, route, {
        ...parameters,
        request: {
          ...options,
          retries: 0,
        },
      }),
      options.signal,
    );
  }

  private assertSpec(spec: SdkGrowthCheckSpec): void {
    if (
      safeNumericId(spec.appId, "sdk_growth_app_id_invalid") !== this.appId ||
      safeNumericId(
        spec.installationId,
        "sdk_growth_installation_id_invalid",
      ) !== this.installationId ||
      safeNumericId(spec.repositoryId, "sdk_growth_repository_id_invalid") !==
        this.repositoryId ||
      spec.repositoryFullName !== `${this.owner}/${this.repo}` ||
      spec.name !== SDK_GROWTH_RESERVED_CHECK_NAME ||
      !/^[a-f0-9]{40}$/u.test(spec.headSha) ||
      !/^rr-sdk-growth-v1:[a-f0-9]{64}$/u.test(spec.externalId) ||
      (spec.conclusion !== "success" && spec.conclusion !== "failure") ||
      !validOutput(spec.output)
    ) {
      throw new Error("sdk_growth_check_spec_invalid");
    }
  }

  private async assertProviderIdentity(
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    signal.throwIfAborted();
    const authentication = record(
      await awaitWithSignal(this.client.auth({ type: "installation" }), signal),
    );
    const permissions = record(authentication.permissions);
    if (
      authentication.type !== "token" ||
      authentication.tokenType !== "installation" ||
      observedNumericId(
        authentication.installationId,
        "sdk_growth_authenticated_installation_invalid",
      ) !== this.installationId ||
      permissions.checks !== "write"
    ) {
      throw new Error("sdk_growth_authenticated_installation_mismatch");
    }

    const appResponse = await this.request("GET /app", {
      request: { signal },
    });
    const app = record(appResponse.data);
    if (
      observedNumericId(app.id, "sdk_growth_app_identity_invalid") !==
      this.appId
    ) {
      throw new Error("sdk_growth_provider_identity_mismatch");
    }
    const installationResponse = await this.request(
      "GET /repos/{owner}/{repo}/installation",
      { owner: this.owner, repo: this.repo, request: { signal } },
    );
    const installation = record(installationResponse.data);
    if (
      observedNumericId(installation.id, "bad_installation") !==
        this.installationId ||
      observedNumericId(installation.app_id, "bad_app") !== this.appId ||
      installation.suspended_at !== null
    ) {
      throw new Error("sdk_growth_provider_identity_mismatch");
    }
    await this.assertInstallationRepository(signal);
    return authentication;
  }

  private async assertInstallationRepository(
    signal: AbortSignal,
  ): Promise<void> {
    let expectedTotal: number | null = null;
    const repositoryIds = new Set<string>();
    let matched = false;
    for (let page = 1; page <= 100; page += 1) {
      const response = await this.request("GET /installation/repositories", {
        per_page: 100,
        page,
        request: { signal },
      });
      const body = record(response.data);
      const repositories = array(body.repositories);
      const total = nonnegativeSafeInteger(
        body.total_count,
        "sdk_growth_installation_repositories_invalid",
      );
      if (repositories.length > 100) {
        throw new Error("sdk_growth_installation_repositories_invalid");
      }
      if (expectedTotal === null) expectedTotal = total;
      if (expectedTotal !== total) {
        throw new Error("sdk_growth_installation_repositories_partial");
      }
      for (const value of repositories) {
        const repository = record(value);
        const id = observedNumericId(
          repository.id,
          "sdk_growth_repository_identity_invalid",
        );
        if (repositoryIds.has(id)) {
          throw new Error("sdk_growth_installation_repositories_partial");
        }
        repositoryIds.add(id);
        if (id === this.repositoryId) {
          if (
            repository.full_name !== `${this.owner}/${this.repo}` ||
            matched
          ) {
            throw new Error("sdk_growth_provider_identity_mismatch");
          }
          matched = true;
        }
      }
      if (repositoryIds.size > total) {
        throw new Error("sdk_growth_installation_repositories_partial");
      }
      if (repositoryIds.size === total) break;
      if (repositories.length < 100) {
        throw new Error("sdk_growth_installation_repositories_partial");
      }
      if (page === 100) {
        throw new Error("sdk_growth_installation_repositories_partial");
      }
    }
    if (!matched) throw new Error("sdk_growth_provider_identity_mismatch");
  }

  private async readAllCheckRuns(
    spec: SdkGrowthCheckSpec,
    signal: AbortSignal,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const rows: Readonly<Record<string, unknown>>[] = [];
    const distinctIds = new Set<string>();
    let expectedTotal: number | null = null;
    for (let page = 1; page <= 100; page += 1) {
      let response: Readonly<{ data: unknown }>;
      try {
        response = await this.request(
          "GET /repos/{owner}/{repo}/commits/{ref}/check-runs",
          {
            owner: this.owner,
            repo: this.repo,
            ref: spec.headSha,
            filter: "all",
            per_page: 100,
            page,
            request: { signal },
          },
        );
      } catch {
        throw new ReadbackError("transport");
      }
      let body: Readonly<Record<string, unknown>>;
      let pageRows: readonly unknown[];
      try {
        body = record(response.data);
        pageRows = array(body.check_runs);
      } catch {
        throw new ReadbackError("malformed-response");
      }
      if (pageRows.length > 100) {
        throw new ReadbackError("malformed-response");
      }
      let total: number;
      try {
        total = nonnegativeSafeInteger(
          body.total_count,
          "sdk_growth_check_total_invalid",
        );
      } catch {
        throw new ReadbackError("malformed-response");
      }
      if (expectedTotal === null) expectedTotal = total;
      if (expectedTotal !== total) {
        throw new ReadbackError("partial-read");
      }
      for (const item of pageRows) {
        try {
          const row = record(item);
          const id = observedNumericId(row.id, "sdk_growth_check_id_invalid");
          rows.push(row);
          distinctIds.add(id);
        } catch {
          throw new ReadbackError("malformed-response");
        }
      }
      if (distinctIds.size > total) throw new ReadbackError("partial-read");
      if (distinctIds.size === total) return rows;
      if (pageRows.length < 100) throw new ReadbackError("partial-read");
    }
    throw new ReadbackError("partial-read");
  }

  private classify(
    rows: readonly Readonly<Record<string, unknown>>[],
    spec: SdkGrowthCheckSpec,
  ): SdkGrowthObservation {
    // Establish identity consistency across the complete paginated read before
    // correlation filtering; otherwise a contradictory duplicate can be hidden
    // by a changed external_id on a later page.
    const allById = new Map<string, string>();
    for (const row of rows) {
      let id: string;
      try {
        id = observedNumericId(row.id, "sdk_growth_check_id_invalid");
      } catch {
        return {
          kind: "unknown",
          reason: "malformed-response",
          at: this.now(),
        };
      }
      const fingerprint = digestEvidence(normalizeForIdentity(row));
      const prior = allById.get(id);
      if (prior && prior !== fingerprint) {
        return this.conflict("unexpected-effect", rows);
      }
      allById.set(id, fingerprint);
    }
    const correlated = rows.filter(
      (row) => row.external_id === spec.externalId,
    );
    if (correlated.length === 0) {
      return { kind: "absent", at: this.now() };
    }

    const byId = new Map<
      string,
      Readonly<{
        row: Readonly<Record<string, unknown>>;
        digest: string;
      }>
    >();
    for (const row of correlated) {
      let id: string;
      let normalized: Readonly<Record<string, unknown>>;
      try {
        id = observedNumericId(row.id, "sdk_growth_check_id_invalid");
        normalized = normalizeCheck(
          row,
          this.repositoryId,
          this.installationId,
        );
      } catch {
        return {
          kind: "unknown",
          reason: "malformed-response",
          at: this.now(),
        };
      }
      const digest = digestEvidence(normalized);
      const prior = byId.get(id);
      if (prior && prior.digest !== digest) {
        return this.conflict("unexpected-effect", correlated);
      }
      byId.set(id, { row, digest });
    }
    if (byId.size > 1) return this.conflict("duplicate", correlated);

    const [id, found] = [...byId.entries()][0]!;
    const row = found.row;
    const app = isRecord(row.app) ? row.app : null;
    let identityMatches: boolean;
    try {
      identityMatches =
        observedNumericId(app?.id, "bad_app") === spec.appId &&
        this.repositoryId === spec.repositoryId &&
        this.installationId === spec.installationId &&
        row.head_sha === spec.headSha &&
        row.name === spec.name &&
        row.external_id === spec.externalId &&
        row.status === "completed" &&
        row.conclusion === spec.conclusion;
    } catch {
      identityMatches = false;
    }
    if (!identityMatches) {
      return this.conflict("identity-mismatch", [row]);
    }
    const output = isRecord(row.output) ? row.output : null;
    if (
      output?.title !== spec.output.title ||
      output.summary !== spec.output.summary ||
      !Object.hasOwn(output, "text") ||
      !Object.hasOwn(output, "annotations_count") ||
      !(output.text === null || output.text === "") ||
      output.annotations_count !== 0
    ) {
      return this.conflict("output-mismatch", [row]);
    }
    return {
      kind: "exact",
      checkRunId: id,
      observedDigest: found.digest,
      at: this.now(),
    };
  }

  private conflict(
    reason:
      | "duplicate"
      | "identity-mismatch"
      | "output-mismatch"
      | "unexpected-effect",
    rows: readonly Readonly<Record<string, unknown>>[],
  ): SdkGrowthObservation {
    const witnessIds = rows
      .flatMap((row) => {
        try {
          return [observedNumericId(row.id, "bad_id")];
        } catch {
          return [];
        }
      })
      .filter((id, index, all) => all.indexOf(id) === index)
      .slice(0, 2);
    return {
      kind: "conflict",
      reason,
      witnessIds,
      evidenceDigest: digestEvidence({
        reason,
        witnesses: witnessIds,
      }),
      at: this.now(),
    };
  }
}

function normalizeForIdentity(row: Readonly<Record<string, unknown>>): unknown {
  return {
    id: row.id,
    external_id: row.external_id,
    name: row.name,
    head_sha: row.head_sha,
    status: row.status,
    conclusion: row.conclusion,
    output: row.output,
    app: row.app,
  };
}

class ReadbackError extends Error {
  constructor(
    readonly reason:
      | "transport"
      | "partial-read"
      | "malformed-response"
      | "unavailable",
  ) {
    super(reason);
  }
}

function normalizeCheck(
  row: Readonly<Record<string, unknown>>,
  repositoryId: string,
  installationId: string,
): Readonly<Record<string, unknown>> {
  const output = record(row.output);
  const app = record(row.app);
  if (
    typeof output.title !== "string" ||
    typeof output.summary !== "string" ||
    !Object.hasOwn(output, "text") ||
    !Object.hasOwn(output, "annotations_count") ||
    (output.text !== null && typeof output.text !== "string") ||
    typeof output.annotations_count !== "number" ||
    !Number.isSafeInteger(output.annotations_count) ||
    output.annotations_count < 0
  ) {
    throw new Error("sdk_growth_check_output_invalid");
  }
  return {
    id: observedNumericId(row.id, "bad_id"),
    appId: observedNumericId(app.id, "bad_app"),
    repositoryId,
    installationId,
    headSha: row.head_sha,
    name: row.name,
    externalId: row.external_id,
    status: row.status,
    conclusion: row.conclusion,
    output: {
      title: output.title,
      summary: output.summary,
      text: output.text,
      annotationsCount: output.annotations_count,
    },
  };
}

function validOutput(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    value.title.length > 0 &&
    Buffer.byteLength(value.title, "utf8") <= 256 &&
    typeof value.summary === "string" &&
    value.summary.length > 0 &&
    Buffer.byteLength(value.summary, "utf8") <= 4_096
  );
}

function safeNumericId(value: unknown, code: string): string {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]*$/u.test(value) ||
    BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error(code);
  }
  return value;
}

function observedNumericId(value: unknown, code: string): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(code);
  }
  return String(value);
}

function splitFullName(value: string): readonly [string, string] {
  const match = /^([^/\s]+)\/([^/\s]+)$/u.exec(value);
  if (!match) throw new Error("sdk_growth_repository_full_name_invalid");
  return [match[1]!, match[2]!];
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error("sdk_growth_response_invalid");
  return value;
}
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error("sdk_growth_response_invalid");
  return value;
}
function httpStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  return Number.isSafeInteger(error.status) ? (error.status as number) : null;
}
function isDefiniteProviderRejection(status: number | null): boolean {
  return (
    status !== null &&
    [
      400, 401, 403, 404, 405, 406, 409, 410, 411, 413, 414, 415, 422, 429,
    ].includes(status)
  );
}
function nonnegativeSafeInteger(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(code);
  }
  return value;
}
function boundedSignal(signal: AbortSignal, deadlineMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(deadlineMs)]);
}
async function awaitWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", aborted);
    });
  });
}
function digestEvidence(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const source = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(source)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`)
    .join(",")}}`;
}

function installationToken(authentication: Record<string, unknown>): string {
  if (
    typeof authentication.token !== "string" ||
    !authentication.token.trim()
  ) {
    throw new Error("sdk_growth_installation_token_missing");
  }
  return authentication.token;
}
