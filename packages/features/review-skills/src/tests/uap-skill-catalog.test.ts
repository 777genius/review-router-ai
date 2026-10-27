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
        { name: "Checks", path: "skills/checks" },
        { name: "Checks", path: "plugins/checks" },
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
          id: "skills-sh/review",
          title: "Review",
          providerUrl: "https://skills.sh/example/skills/review",
          skillNameHint: "review",
          source: { kind: "github", repository },
          availability: "unverified",
        },
      ],
      page: 0,
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
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
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
