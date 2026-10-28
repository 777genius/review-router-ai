import { describe, expect, it } from "vitest";
import {
  readMcpSecretsExpression,
  renderMcpSecretsExpression,
  renderReviewRouterCaller,
} from "./index";

const expression =
  '${{ format(\'{{"DOCS_KEY":{0},"Z_KEY":{1}}}\', toJSON(secrets.ORG_DOCS_TOKEN), toJSON(secrets.Z_TOKEN)) }}';

describe("explicit MCP GitHub secret binding grammar", () => {
  it("renders named values in ASCII logical order and roundtrips the exact binding", () => {
    const binding = { Z_KEY: "Z_TOKEN", DOCS_KEY: "ORG_DOCS_TOKEN" };
    expect(renderMcpSecretsExpression(binding)).toBe(expression);
    expect(readMcpSecretsExpression(expression)).toEqual({
      DOCS_KEY: "ORG_DOCS_TOKEN",
      Z_KEY: "Z_TOKEN",
    });
    expect(renderReviewRouterCaller({ mcpSecrets: binding })).toContain(
      `    secrets:\n      mcp_secrets_json: ${expression}\n`,
    );
    expect(renderMcpSecretsExpression({ DOCS_KEY: "ORG_DOCS_TOKEN" })).toBe(
      "${{ format('{{\"DOCS_KEY\":{0}}}', toJSON(secrets.ORG_DOCS_TOKEN)) }}",
    );
  });

  it("leaves callers byte-identical when the mapping is absent or empty", () => {
    expect(renderMcpSecretsExpression({})).toBeUndefined();
    expect(renderReviewRouterCaller({ mcpSecrets: {} })).toBe(
      renderReviewRouterCaller(),
    );
    expect(renderReviewRouterCaller()).not.toContain("secrets:");
  });

  it("rejects invalid names rather than interpolating attacker-controlled expressions", () => {
    const invalidBindings: Record<string, string>[] = [
      { bad_name: "TOKEN" },
      { DOCS_KEY: "secrets.TOKEN" },
      { DOCS_KEY: "TOKEN) || toJSON(secrets)" },
      { "KEY\nsecrets": "TOKEN" },
      { DOCS_KEY: "" },
    ];
    for (const binding of invalidBindings) {
      expect(() => renderMcpSecretsExpression(binding)).toThrow(
        "review_workflow_mcp_secrets_invalid",
      );
    }
  });

  it("rejects bulk secrets, indexing, duplicates, noncanonical ordering and expression extensions", () => {
    const malformed: unknown[] = [
      undefined,
      {},
      "inherit",
      "${{ toJSON(secrets) }}",
      expression.replace("toJSON(secrets.ORG_DOCS_TOKEN)", "toJSON(secrets)"),
      expression.replace("secrets.ORG_DOCS_TOKEN", "secrets['ORG_DOCS_TOKEN']"),
      expression.replace('"Z_KEY":{1}', '"DOCS_KEY":{1}'),
      expression.replace('"Z_KEY":{1}', '"Z_KEY":{0}'),
      expression.replace(
        '"DOCS_KEY":{0},"Z_KEY":{1}',
        '"Z_KEY":{0},"DOCS_KEY":{1}',
      ),
      expression.replace(") }}", ") || toJSON(secrets) }}"),
      expression.replace(
        ", toJSON(secrets.Z_TOKEN)",
        ", toJSON(secrets.Z_TOKEN), toJSON(secrets.EXTRA)",
      ),
    ];
    for (const value of malformed)
      expect(() => readMcpSecretsExpression(value)).toThrow(
        "review_workflow_mcp_secrets_invalid",
      );
  });
});
