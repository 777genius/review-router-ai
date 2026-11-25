import { afterEach, expect, it, vi } from "vitest";
import { captureContextToolsPlan } from "@reviewrouter/features-review-context-tools";
import type { McpCatalogConnection } from "../../../src/features/context-tools/mcp-catalog";
import { namespaceNewDashboardBindings } from "./context-connection-draft";

afterEach(() => vi.restoreAllMocks());

it("namespaces independent API-key preset clones into a compatible combined plan without mutating the preset", () => {
  vi.spyOn(crypto, "randomUUID")
    .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
    .mockReturnValueOnce("22222222-2222-4222-8222-222222222222");
  const firstName = `${"A".repeat(63)}B`;
  const secondName = `${"A".repeat(63)}C`;
  // A synthetic supported API-key adapter contract, not a claim about a vendor.
  const preset: McpCatalogConnection = {
    id: "a".repeat(32),
    url: "https://mcp.example.test/mcp",
    headers: {
      Authorization: "Bearer ${{ secrets." + firstName + " }}",
      "X-Token": `{{ secrets.${secondName} }}`,
    },
    credentials: {
      [firstName]: { source: "dashboard-secret" },
      [secondName]: { source: "dashboard-secret" },
    },
  };
  const original = structuredClone(preset);
  const first = namespaceNewDashboardBindings(preset);
  const second = namespaceNewDashboardBindings(preset);
  expect(preset).toEqual(original);
  const allNames = [
    ...Object.keys(first.credentials),
    ...Object.keys(second.credentials),
  ];
  expect(new Set(allNames).size).toBe(4);
  expect(allNames.every((name) => /^[A-Z][A-Z0-9_]{63}$/.test(name))).toBe(
    true,
  );
  for (const draft of [first, second]) {
    const [one, two] = Object.keys(draft.credentials);
    expect(draft.headers).toEqual({
      Authorization: `Bearer \${{ secrets.${one} }}`,
      "X-Token": `{{ secrets.${two} }}`,
    });
  }
  const plan = captureContextToolsPlan(
    {
      version: 1,
      builtinTools: [],
      mcp: [
        { connection: "first", tools: ["search"] },
        { connection: "second", tools: ["search"] },
      ],
    },
    [first, second].map((draft, index) => ({
      workspaceId: "workspace",
      enabled: true,
      version: 1,
      encryptedSecrets: "opaque",
      definition: {
        ...draft,
        id: index === 0 ? "first" : "second",
        tools: ["search"],
      },
    })),
  );
  expect(plan.servers).toHaveLength(2);
  expect(
    plan.servers.flatMap((server) => Object.keys(server.credentials)),
  ).toEqual(allNames);
});
