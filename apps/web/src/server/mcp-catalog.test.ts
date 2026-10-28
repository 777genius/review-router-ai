import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  listDashboardMcpCatalogPresets,
  mapReviewedMcpPreset,
} from "./mcp-catalog";
import reviewed from "./mcp-catalog-data/uap-reviewed.json";

function docs() {
  return structuredClone(
    reviewed.entries.find((entry) => entry.product.id === "cloudflare-docs")!,
  );
}
function manifest(
  entry: ReturnType<typeof docs>,
  server: Record<string, unknown>,
): void {
  entry.mcpManifest = JSON.stringify({
    $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
    mcpServers: { docs: server },
  });
  entry.mcpManifestDigest = `sha256:${createHash("sha256").update(entry.mcpManifest).digest("hex")}`;
}

describe("reviewed UAP catalog", () => {
  it("pins published main and inventories every MCP product without inventing registry entries", () => {
    expect(reviewed.registryRevision).toBe(
      "803f82a0ea89c634a5a22a070d19473ee41d18a9",
    );
    const presets = listDashboardMcpCatalogPresets();
    expect(presets).toHaveLength(28);
    expect(
      reviewed.entries.filter((entry) => !entry.unavailableReason),
    ).toHaveLength(26);
    expect(
      presets.find((preset) => preset.id === "firebase")?.releaseSequence,
    ).toBe(6);
    expect(
      presets.find((preset) => preset.id === "hubspot-developer")
        ?.releaseSequence,
    ).toBe(6);
    expect(
      presets
        .filter((preset) => preset.compatibility.status === "supported")
        .map((preset) => preset.id),
    ).toEqual(["cloudflare-docs", "firecrawl"]);
    expect(presets.map((preset) => preset.id)).not.toContain("deepwiki");
    expect(presets.map((preset) => preset.id)).not.toContain("microsoft-learn");
    const cloudflare = presets.find(
      (preset) => preset.id === "cloudflare-docs",
    )!;
    expect(cloudflare).toMatchObject({
      distributionId: "777genius/cloudflare-docs-bridge",
      releaseSequence: 2,
      targetClient: "opencode",
      registryAuthentication: "not_required",
      compatibility: {
        status: "supported",
        authentication: "none",
        connection: {
          id: "cloudflare_docs",
          url: "https://docs.mcp.cloudflare.com/mcp",
          headers: {},
          credentials: {},
        },
      },
    });
    expect(cloudflare.sourceUrl).toContain(
      `/tree/${reviewed.registryRevision}/plugins/cloudflare-docs`,
    );
    expect(JSON.stringify(presets)).not.toContain("mcpManifest");
    expect(JSON.stringify(presets)).not.toContain("command");
    expect(cloudflare.compatibility).not.toHaveProperty("connection.tools");
  });

  it("refuses changed manifest bytes or a different distribution/release policy", () => {
    const changedMcp = docs();
    changedMcp.mcpManifest += " ";
    const changedManifest = docs();
    changedManifest.manifest += " ";
    const changedDistribution = docs();
    changedDistribution.product.default_distribution = "other/docs";
    const changedRelease = docs();
    changedRelease.policy!.release_sequence++;
    const inactive = docs();
    inactive.policy!.status = "revoked";
    for (const entry of [
      changedMcp,
      changedManifest,
      changedDistribution,
      changedRelease,
      inactive,
    ]) {
      expect(mapReviewedMcpPreset(entry).compatibility.status).toBe(
        "unsupported",
      );
    }
  });

  it("does not use another client's anonymous policy, or guess unknown/required authentication", () => {
    for (const authentication of ["required", "unknown"]) {
      const entry = docs();
      entry.policy!.targets[0]!.authentication = authentication;
      expect(mapReviewedMcpPreset(entry).compatibility.status).toBe(
        "unsupported",
      );
    }
    const anotherClient = docs();
    anotherClient.policy!.targets[0]!.client = "codex";
    expect(mapReviewedMcpPreset(anotherClient).compatibility.status).toBe(
      "unsupported",
    );
  });

  it("maps only exact required-auth header placeholders to named dashboard secrets", () => {
    const entry = docs();
    entry.policy!.targets[0]!.authentication = "required";
    manifest(entry, {
      type: "streamable-http",
      url: "https://docs.example.test/mcp",
      headers: {
        Authorization: "Bearer ${DOCS_TOKEN}",
        "X-Api-Key": "${DOCS_KEY}",
      },
    });
    expect(mapReviewedMcpPreset(entry).compatibility).toMatchObject({
      status: "supported",
      authentication: "api-key",
      connection: {
        headers: {
          Authorization: "Bearer {{ secrets.DOCS_TOKEN }}",
          "X-Api-Key": "{{ secrets.DOCS_KEY }}",
        },
        credentials: {
          DOCS_TOKEN: { source: "dashboard-secret" },
          DOCS_KEY: { source: "dashboard-secret" },
        },
      },
    });
    for (const headers of [
      { Authorization: "Bearer literal-secret" },
      { Authorization: "${TOKEN}/extra" },
      { Host: "${TOKEN}" },
    ]) {
      manifest(entry, {
        type: "streamable-http",
        url: "https://docs.example.test/mcp",
        headers,
      });
      expect(
        mapReviewedMcpPreset(entry).compatibility.status,
        `Headers: ${JSON.stringify(headers)}`,
      ).toBe("unsupported");
    }
  });

  it("refuses stdio, OAuth metadata, unsafe URLs and unexpected headers for anonymous presets", () => {
    for (const server of [
      { type: "stdio", command: "must-never-execute" },
      { type: "streamable-http", url: "http://docs.example.test/mcp" },
      {
        type: "streamable-http",
        url: "https://docs.example.test/mcp?token=secret",
      },
      {
        type: "streamable-http",
        url: "https://docs.example.test/mcp",
        oauth: true,
      },
      {
        type: "streamable-http",
        url: "https://docs.example.test/mcp",
        headers: { Authorization: "${TOKEN}" },
      },
    ]) {
      const entry = docs();
      manifest(entry, server);
      expect(mapReviewedMcpPreset(entry).compatibility.status).toBe(
        "unsupported",
      );
    }
    const presets = listDashboardMcpCatalogPresets();
    expect(
      presets.find((preset) => preset.id === "playwright")!.compatibility,
    ).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("stdio"),
    });
    expect(
      presets.find((preset) => preset.id === "cloudflare-bindings")!
        .compatibility,
    ).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("authentication"),
    });
    expect(
      presets.find((preset) => preset.id === "context7")!.compatibility,
    ).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("authentication"),
    });
  });
});
