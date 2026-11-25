import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { HttpUapSkillCatalog } from "../infrastructure/http/uap-skill-catalog.js";

const repository = "example/skills";
const commit = "1".repeat(40);
const rawContent =
  "---\nname: review\ndescription: Checks\n---\nPreserve café.\r\n";
function resolved() {
  return {
    version: 1,
    status: "resolved",
    repository,
    commit,
    skill: {
      path: "",
      name: "review",
      description: "Checks",
      rawContent,
      rawSha256: createHash("sha256").update(rawContent).digest("hex"),
      hasResources: false,
    },
  };
}
function fixture(body: unknown, status = 200, headers = {}) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    }),
  );
  return {
    fetch,
    source: new HttpUapSkillCatalog({ resolveToken: "service-token", fetch }),
  };
}

describe("bounded UAP catalog adapter", () => {
  it("keeps root-directory selection and exact UTF-8 source identity, without forwarding actor input", async () => {
    const { fetch, source } = fixture(resolved());
    const input = {
      repository,
      commit,
      path: "",
      actor: { userId: "private-actor" },
    };
    expect(await source.resolve(input)).toEqual({
      status: "resolved",
      source: { repository, commit, path: "" },
      rawContent,
      rawDigest: resolved().skill.rawSha256,
      hasResources: false,
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://api.universal-agent-plugins.com/v1/skills/resolve",
    );
    expect(init).toMatchObject({
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      repository,
      commit,
      path: "",
    });
    expect(init?.headers).toMatchObject({
      authorization: "Bearer service-token",
    });
  });

  it.each(["digest", "commit", "path", "repository", "version"])(
    "rejects mismatched %s instead of staging different content",
    async (field) => {
      const response = resolved();
      if (field === "digest") response.skill.rawSha256 = "0".repeat(64);
      if (field === "commit") response.commit = "2".repeat(40);
      if (field === "path") response.skill.path = "elsewhere";
      if (field === "repository") response.repository = "other/skills";
      if (field === "version") response.version = 2;
      await expect(
        fixture(response).source.resolve({ repository, commit, path: "" }),
      ).rejects.toMatchObject({ code: "unavailable" });
    },
  );

  it("keeps ambiguous immutable choices rather than deriving a path from the catalog hint", async () => {
    const { source } = fixture({
      version: 1,
      status: "selection_required",
      repository,
      commit,
      candidates: [
        {
          name: "Checks",
          description: "Review instructions",
          path: "skills/checks",
        },
        {
          name: "Checks",
          description: "Review instructions",
          path: "plugins/checks",
        },
      ],
    });
    expect(
      await source.resolve({ repository, skillNameHint: "checks" }),
    ).toMatchObject({
      status: "selection_required",
      commit,
      candidates: [{ path: "skills/checks" }, { path: "plugins/checks" }],
    });
  });

  it("marks bounded search as limited and does not invent a next search page", async () => {
    const { source, fetch } = fixture({
      items: [
        {
          id: "skills-sh:example/skills:review",
          title: "Review",
          providerUrl: "https://skills.sh/example/skills/review",
          skillNameHint: "review",
          source: { kind: "github", repository },
          availability: "unverified",
        },
      ],
      page: 0,
      query: "review",
      hasMore: true,
      cache: { status: "stale" },
    });
    expect(await source.search({ query: "review", page: 0 })).toMatchObject({
      page: 0,
      hasMore: false,
      limited: true,
      stale: true,
      items: [{ repository, available: true }],
    });
    const [, init] = fetch.mock.calls[0]!;
    expect(init?.headers).not.toHaveProperty("authorization");
  });

  it("preserves mixed-case GitHub listing identity including valid underscored repository names", async () => {
    const { source } = fixture({
      items: [
        {
          id: "skills-sh:Example/_Skills:review",
          title: "Review",
          providerUrl: "https://skills.sh/Example/_Skills/review",
          skillNameHint: "review",
          source: { kind: "github", repository: "Example/_Skills" },
          availability: "unverified",
        },
      ],
      page: 0,
      total: 1,
      hasMore: false,
      cache: { status: "fresh" },
    });
    expect((await source.search({ query: "", page: 0 })).items).toMatchObject([
      { repository: "Example/_Skills", available: true },
    ]);
  });

  it("uses the resolver's UTF-8 path byte cap and rejects control characters in returned choices", async () => {
    const path = "é".repeat(2048);
    const response = resolved();
    response.skill.path = path;
    expect(
      await fixture(response).source.resolve({ repository, commit, path }),
    ).toMatchObject({
      status: "resolved",
      source: { path },
    });
    for (const invalid of [`${path}x`, "skills/line\nfeed", "skills/tab\tpath"])
      await expect(
        fixture({
          version: 1,
          status: "selection_required",
          repository,
          commit,
          candidates: [
            { name: "review", description: "Checks", path: invalid },
          ],
        }).source.resolve({ repository }),
      ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("fails unavailable with bounded retry timing and never exposes upstream error bodies", async () => {
    await expect(
      fixture({ error: "private-upstream-detail" }, 503, {
        "retry-after": "8",
      }).source.resolve({ repository }),
    ).rejects.toMatchObject({
      code: "unavailable",
      details: { retryAfterSeconds: 8 },
    });
  });

  it("refuses oversized streamed JSON and malformed UTF-8 before staging", async () => {
    for (const body of [
      new Uint8Array(256 * 1024 + 1).fill(32),
      new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125]),
    ]) {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        new Response(body, {
          headers: { "content-type": "application/json" },
        }),
      );
      await expect(
        new HttpUapSkillCatalog({ resolveToken: "token", fetch }).resolve({
          repository,
        }),
      ).rejects.toMatchObject({ code: "unavailable" });
    }
  });

  it.each([
    "https://attacker.example",
    "http://127.0.0.1:9999",
    "https://api.universal-agent-plugins.com/other",
    "https://user:secret@api.universal-agent-plugins.com",
  ])("rejects unconfigured destination %s", (baseUrl) => {
    expect(
      () => new HttpUapSkillCatalog({ resolveToken: "token", baseUrl }),
    ).toThrow("invalid_uap_catalog_origin");
  });
});
