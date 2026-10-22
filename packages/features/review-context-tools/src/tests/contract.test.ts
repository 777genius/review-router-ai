import { describe, expect, it } from "vitest";
import {
  canonicalContextJson,
  captureContextToolsPlan,
  contextConnectionDefinitionSchema,
  contextPlanDigest,
  contextToolLimits,
  contextToolsSelectionSchema,
  httpsMcpUrlSchema,
  parseContextToolsPlan,
  referencedContextSecrets,
  type ContextConnection,
  type ContextConnectionDefinition,
  type ContextToolsPlan,
} from "../domain/context-tools.js";

const definition: ContextConnectionDefinition = {
  id: "docs",
  url: "https://mcp.example.com/api",
  tools: ["search"],
  headers: { Authorization: "Bearer ${{ secrets.TOKEN }}" },
  credentials: { TOKEN: { source: "github-secret", name: "ORG_TOKEN" } },
};
const connection = (id = "docs"): ContextConnection => ({
  workspaceId: "workspace",
  version: 1,
  enabled: true,
  definition: { ...definition, id },
  encryptedSecrets: null,
});
const selection = {
  version: 1 as const,
  builtinTools: [],
  mcp: [{ connection: "docs", tools: ["search"] }],
};
function resign(plan: ContextToolsPlan): ContextToolsPlan {
  const { planDigest: _digest, ...rest } = plan;
  void _digest;
  return { ...rest, planDigest: contextPlanDigest(rest) };
}

describe("context tools persisted contract", () => {
  it("uses ASCII key order recursively and binds every plan field except planDigest", () => {
    expect(
      canonicalContextJson({ z: [{ a: 1, Z: 2 }], a: 3, Z: 4, A: 5 }),
    ).toBe('{"A":5,"Z":4,"a":3,"z":[{"Z":2,"a":1}]}');
    const empty = {
      version: 1 as const,
      builtinTools: [],
      servers: [],
      limits: contextToolLimits,
    };
    expect(contextPlanDigest(empty)).toBe(
      "sha256:c2bbfd85e7efa0a98e3cf9ae7cc804b6856537a94d56f06689419e425fd40a72",
    );
    const plan = captureContextToolsPlan(selection, [connection()]);
    expect(parseContextToolsPlan(JSON.parse(JSON.stringify(plan)))).toEqual(
      plan,
    );
    expect(() =>
      parseContextToolsPlan({ ...plan, builtinTools: ["github.issue.read"] }),
    ).toThrow("context_plan_invalid");
    expect(() =>
      parseContextToolsPlan({
        ...plan,
        servers: [{ ...plan.servers[0]!, version: 2 }],
      }),
    ).toThrow("context_plan_invalid");
    expect(() =>
      parseContextToolsPlan({
        ...plan,
        limits: { ...plan.limits, maxCalls: 129 },
      }),
    ).toThrow();
    expect(() =>
      parseContextToolsPlan({ ...plan, plaintextSecrets: {} }),
    ).toThrow();
  });

  it("requires an unambiguous HTTPS endpoint without embedded credentials or URL state", () => {
    for (const url of [
      "http://mcp.example.com",
      "file:///tmp/mcp",
      "https://user:password@mcp.example.com",
      "https://mcp.example.com?token=x",
      "https://mcp.example.com#secret",
      "https://mcp.example.com./api",
      "not-a-url",
      "https://mcp.example.com/{key}",
      "https://mcp.example.com/$token",
    ]) {
      expect(httpsMcpUrlSchema.safeParse(url).success).toBe(false);
    }
    expect(httpsMcpUrlSchema.parse("https://mcp.example.com/api")).toBe(
      "https://mcp.example.com/api",
    );
  });

  it("allows both named template spellings and rejects plaintext, CRLF, proxy headers and malformed bindings", () => {
    for (const template of [
      "Bearer ${{ secrets.TOKEN }}",
      "Bearer {{ secrets.TOKEN }}",
    ]) {
      expect(referencedContextSecrets(template)).toEqual(["TOKEN"]);
      expect(
        contextConnectionDefinitionSchema.safeParse({
          ...definition,
          headers: { Authorization: template },
        }).success,
      ).toBe(true);
    }
    const headers = [
      { Authorization: "Bearer private-token" },
      { Authorization: "Bearer ${{ secrets.TOKEN }}\r\nX-Hijack: yes" },
      { Authorization: "{{ secrets.UNKNOWN }}" },
      { Authorization: "{{ env.TOKEN }}" },
      { Authorization: "{{ secrets.TOKEN }}{{ incomplete" },
      { Authorization: "{{ secrets.TOKEN }} trailing{" },
      { "X-Forwarded-Host": "{{ secrets.TOKEN }}" },
      { Host: "{{ secrets.TOKEN }}" },
      { "1": "{{ secrets.TOKEN }}" },
      { "Mcp-Session-Id": "{{ secrets.TOKEN }}" },
      {
        Authorization: "{{ secrets.TOKEN }}",
        authorization: "{{ secrets.TOKEN }}",
      },
      { Authorization: "{{ secrets.TOKEN }}\0" },
    ];
    for (const value of headers)
      expect(
        contextConnectionDefinitionSchema.safeParse({
          ...definition,
          headers: value,
        }).success,
      ).toBe(false);
    expect(
      contextConnectionDefinitionSchema.safeParse({
        ...definition,
        headers: { "Api-Key": "{{ secrets.TOKEN }}" },
      }).success,
    ).toBe(true);
    const manyBindings = Object.fromEntries(
      Array.from({ length: 17 }, (_, i) => [
        `TOKEN_${i}`,
        { source: "github-secret", name: `SECRET_${i}` },
      ]),
    );
    expect(
      contextConnectionDefinitionSchema.safeParse({
        ...definition,
        headers: {
          Authorization: Object.keys(manyBindings)
            .map((name) => `{{ secrets.${name} }}`)
            .join(" "),
        },
        credentials: manyBindings,
      }).success,
    ).toBe(false);
    expect(
      contextConnectionDefinitionSchema.safeParse({
        ...definition,
        credentials: {},
      }).success,
    ).toBe(false);
    expect(
      contextConnectionDefinitionSchema.safeParse({
        ...definition,
        credentials: {
          ...definition.credentials,
          EXTRA: { source: "dashboard-secret" },
        },
      }).success,
    ).toBe(false);
    expect(
      contextConnectionDefinitionSchema.safeParse({
        ...definition,
        credentials: { TOKEN: { source: "environment", name: "TOKEN" } },
      }).success,
    ).toBe(false);
    expect(
      contextConnectionDefinitionSchema.safeParse({
        ...definition,
        credentials: {
          TOKEN: { source: "dashboard-secret", name: "unexpected" },
        },
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate or unknown selections and tools outside the connection allowlist", () => {
    expect(
      contextToolsSelectionSchema.safeParse({
        ...selection,
        mcp: [...selection.mcp, ...selection.mcp],
      }).success,
    ).toBe(false);
    expect(
      contextToolsSelectionSchema.safeParse({
        ...selection,
        mcp: [{ connection: "docs", tools: ["search", "search"] }],
      }).success,
    ).toBe(false);
    expect(
      contextToolsSelectionSchema.safeParse({ ...selection, unexpected: true })
        .success,
    ).toBe(false);
    expect(() =>
      captureContextToolsPlan(
        { ...selection, mcp: [{ connection: "docs", tools: ["admin"] }] },
        [connection()],
      ),
    ).toThrow("context_connection_unavailable");
    expect(() =>
      captureContextToolsPlan(selection, [{ ...connection(), enabled: false }]),
    ).toThrow("context_connection_unavailable");
    expect(() => captureContextToolsPlan(selection, [])).toThrow(
      "context_connection_unavailable",
    );
  });

  it("rejects a logical name with different refs, sources or revisions across servers", () => {
    const plan = captureContextToolsPlan(
      {
        ...selection,
        mcp: [...selection.mcp, { connection: "other", tools: ["search"] }],
      },
      [connection(), connection("other")],
    );
    const [first, second] = plan.servers;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    for (const credential of [
      { source: "github-secret" as const, name: "ANOTHER_TOKEN" },
      {
        source: "dashboard-secret" as const,
        credentialRef: "other",
        version: 1,
      },
    ]) {
      expect(() =>
        parseContextToolsPlan(
          resign({
            ...plan,
            servers: [
              first!,
              { ...second!, credentials: { TOKEN: credential } },
            ],
          }),
        ),
      ).toThrow("context_secret_ambiguous");
    }
    const shared = {
      source: "dashboard-secret" as const,
      credentialRef: "docs",
      version: 1,
    };
    for (const credential of [
      { ...shared, credentialRef: "other" },
      { ...shared, version: 2 },
    ]) {
      expect(() =>
        parseContextToolsPlan(
          resign({
            ...plan,
            servers: [
              { ...first!, credentials: { TOKEN: shared } },
              { ...second!, credentials: { TOKEN: credential } },
            ],
          }),
        ),
      ).toThrow("context_secret_ambiguous");
    }
  });

  it("captures no MCP connection or credential when only builtin tools are selected", () => {
    const plan = captureContextToolsPlan(
      { version: 1, builtinTools: ["repository.docs.read"], mcp: [] },
      [connection()],
    );
    expect(plan.builtinTools).toEqual(["repository.docs.read"]);
    expect(plan.servers).toEqual([]);
    expect(JSON.stringify(plan)).not.toContain("ORG_TOKEN");
  });
});

it("matches the private/public companion fixture including mixed-case HTTP headers", async () => {
  const { default: fixture } = await import("./fixtures/context-tools-v1.json");
  const captured = captureContextToolsPlan(
    {
      version: 1,
      builtinTools: ["github.issue.read"],
      mcp: [
        { connection: "context7", tools: ["resolve-library-id", "query-docs"] },
      ],
    },
    [
      {
        workspaceId: "workspace",
        version: 2,
        enabled: true,
        encryptedSecrets: "not-exported",
        definition: {
          id: "context7",
          url: "https://mcp.context7.com/mcp",
          headers: {
            Authorization: "Bearer ${{ secrets.DOCS_TOKEN }}",
            "Api-Key": "{{ secrets.CONTEXT7_KEY }}",
          },
          tools: ["resolve-library-id", "query-docs"],
          credentials: {
            DOCS_TOKEN: { source: "github-secret", name: "DOCS_MCP_TOKEN" },
            CONTEXT7_KEY: { source: "dashboard-secret" },
          },
        },
      },
    ],
  );
  expect(canonicalContextJson(captured)).toBe(canonicalContextJson(fixture));
  expect(parseContextToolsPlan(fixture)).toEqual(captured);
});
