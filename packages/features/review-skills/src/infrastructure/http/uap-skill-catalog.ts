import { createHash } from "node:crypto";
import type {
  ReviewSkillsCatalogPage,
  ReviewSkillsCatalogSelection,
  ReviewSkillsCatalogSourcePort,
} from "../../application/catalog-contracts.js";
import {
  ReviewSkillsError,
  ReviewSkillsErrorCode,
} from "../../domain/errors.js";

type ObjectValue = Record<string, unknown>;
const repositoryPattern =
  /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/u;
const commitPattern = /^[a-f0-9]{40}$/u;
const digestPattern = /^[a-f0-9]{64}$/u;

function unavailable(): never {
  throw new ReviewSkillsError(ReviewSkillsErrorCode.Unavailable);
}
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return unavailable();
  return value as ObjectValue;
}
function text(value: unknown, max = 1024): string {
  if (typeof value !== "string" || value.length > max) return unavailable();
  for (const character of value) {
    const code = character.charCodeAt(0);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127)
      return unavailable();
  }
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") return unavailable();
  return value;
}
function sourcePath(value: unknown): string {
  const path = text(value, 4096);
  if (
    Buffer.byteLength(path, "utf8") > 4096 ||
    /[\\\t\r\n]/u.test(path) ||
    (path &&
      (path.startsWith("/") ||
        path.split("/").some((part) => !part || part === "." || part === "..")))
  )
    return unavailable();
  return path;
}

async function boundedJson(
  response: Response,
  maximumBytes: number,
): Promise<ObjectValue> {
  const size = Number(response.headers.get("content-length"));
  if (
    (Number.isFinite(size) && size > maximumBytes) ||
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/json") ||
    !response.body
  ) {
    await response.body?.cancel();
    return unavailable();
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  let result = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximumBytes) return unavailable();
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
    return object(JSON.parse(result));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Only configured UAP endpoints are fetched; result URLs never become requests. */
export class HttpUapSkillCatalog implements ReviewSkillsCatalogSourcePort {
  private readonly baseUrl: URL;
  private readonly fetch: typeof globalThis.fetch;

  constructor(
    private readonly options: Readonly<{
      resolveToken: string;
      baseUrl?: string;
      fetch?: typeof globalThis.fetch;
      allowLoopback?: boolean;
    }>,
  ) {
    this.baseUrl = new URL(
      options.baseUrl ?? "https://api.universal-agent-plugins.com",
    );
    const production =
      this.baseUrl.protocol === "https:" &&
      this.baseUrl.hostname === "api.universal-agent-plugins.com" &&
      !this.baseUrl.port;
    const loopback =
      options.allowLoopback === true &&
      this.baseUrl.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(this.baseUrl.hostname);
    if (
      (!production && !loopback) ||
      this.baseUrl.username ||
      this.baseUrl.password ||
      this.baseUrl.search ||
      this.baseUrl.hash ||
      this.baseUrl.pathname !== "/"
    ) {
      throw new Error("invalid_uap_catalog_origin");
    }
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  private async request(
    path: string,
    init: RequestInit,
    maximumBytes: number,
    timeout: number,
  ): Promise<ObjectValue> {
    try {
      const response = await this.fetch(new URL(path, this.baseUrl), {
        ...init,
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
        signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) {
        await response.body?.cancel();
        const seconds = Number(response.headers.get("retry-after"));
        throw new ReviewSkillsError(
          ReviewSkillsErrorCode.Unavailable,
          Number.isFinite(seconds) && seconds > 0 && seconds <= 3600
            ? { retryAfterSeconds: Math.ceil(seconds) }
            : {},
        );
      }
      return await boundedJson(response, maximumBytes);
    } catch (error) {
      if (error instanceof ReviewSkillsError) throw error;
      return unavailable();
    }
  }

  async search(
    input: Readonly<{ query: string; page: number }>,
  ): Promise<ReviewSkillsCatalogPage> {
    const parameters = new URLSearchParams();
    const searching = Array.from(input.query.trim()).length >= 2;
    if (searching) {
      parameters.set("q", input.query.trim());
      parameters.set("limit", "50");
    } else {
      parameters.set("view", "popular");
      parameters.set("page", String(input.page));
    }
    const payload = await this.request(
      `/v1/skills?${parameters}`,
      { headers: { accept: "application/json" } },
      2 * 1024 * 1024,
      10_000,
    );
    if (
      !Array.isArray(payload.items) ||
      payload.items.length > 200 ||
      !Number.isInteger(payload.page) ||
      payload.page !== (searching ? 0 : input.page)
    )
      return unavailable();
    const cache = object(payload.cache);
    if (cache.status !== "fresh" && cache.status !== "stale")
      return unavailable();
    const items = payload.items.map((entry) => {
      const row = object(entry);
      const source = object(row.source);
      const repository =
        typeof source.repository === "string" &&
        repositoryPattern.test(source.repository) &&
        ![".", ".."].includes(source.repository.split("/")[1]!)
          ? source.repository
          : null;
      let providerUrl: URL;
      try {
        providerUrl = new URL(text(row.providerUrl, 4096));
      } catch {
        return unavailable();
      }
      if (
        providerUrl.protocol !== "https:" ||
        !["skills.sh", "www.skills.sh"].includes(providerUrl.hostname) ||
        providerUrl.username ||
        providerUrl.password ||
        providerUrl.port
      )
        return unavailable();
      return {
        id: text(row.id),
        title: text(row.title),
        repository,
        skillNameHint:
          typeof row.skillNameHint === "string"
            ? text(row.skillNameHint)
            : null,
        providerUrl: providerUrl.href,
        available:
          row.availability === "unverified" &&
          source.kind === "github" &&
          repository !== null,
      };
    });
    return {
      items,
      page: payload.page as number,
      hasMore: searching ? false : boolean(payload.hasMore),
      limited: searching,
      stale: cache.status === "stale",
    };
  }

  async resolve(
    input: ReviewSkillsCatalogSelection,
  ): ReturnType<ReviewSkillsCatalogSourcePort["resolve"]> {
    if (!this.options.resolveToken) return unavailable();
    const payload = await this.request(
      "/v1/skills/resolve",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${this.options.resolveToken}`,
        },
        body: JSON.stringify({
          repository: input.repository,
          ...(input.skillNameHint !== undefined
            ? { skillNameHint: input.skillNameHint }
            : {}),
          ...(input.commit !== undefined ? { commit: input.commit } : {}),
          ...(input.path !== undefined ? { path: input.path } : {}),
        }),
      },
      256 * 1024,
      35_000,
    );
    if (payload.version !== 1 || payload.repository !== input.repository)
      return unavailable();
    if (payload.status === "not_found" || payload.status === "incomplete")
      return { status: payload.status };
    const commit = text(payload.commit, 40);
    if (
      !commitPattern.test(commit) ||
      (input.commit !== undefined && commit !== input.commit)
    )
      return unavailable();
    if (payload.status === "selection_required") {
      if (
        !Array.isArray(payload.candidates) ||
        payload.candidates.length > 128 ||
        input.commit !== undefined
      )
        return unavailable();
      return {
        status: "selection_required",
        repository: input.repository,
        commit,
        candidates: payload.candidates.map((candidate) => {
          const value = object(candidate);
          return { name: text(value.name), path: sourcePath(value.path) };
        }),
      };
    }
    if (payload.status !== "resolved") return unavailable();
    const skill = object(payload.skill);
    const path = sourcePath(skill.path);
    if (input.path !== undefined && path !== input.path) return unavailable();
    const rawContent = text(skill.rawContent, 64 * 1024);
    if (
      Buffer.byteLength(rawContent, "utf8") > 64 * 1024 ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
        rawContent,
      )
    )
      return unavailable();
    const rawDigest = text(skill.rawSha256, 64);
    if (
      !digestPattern.test(rawDigest) ||
      createHash("sha256").update(rawContent, "utf8").digest("hex") !==
        rawDigest
    )
      return unavailable();
    return {
      status: "resolved",
      source: { repository: input.repository, commit, path },
      rawContent,
      rawDigest,
      hasResources: boolean(skill.hasResources),
    };
  }
}
