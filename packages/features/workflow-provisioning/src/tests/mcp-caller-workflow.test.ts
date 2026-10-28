import { describe, expect, it } from "vitest";
import {
  renderMcpSecretsExpression,
  renderReviewRouterCaller,
} from "@reviewrouter/protocol-review-workflow";
import {
  readManagedReviewRouterCallerSource,
  readReviewRouterCallerSource,
  renderAccountGatewayWorkflow,
} from "../domain/workflow-template";

const mcpSecrets = { DOCS_KEY: "ORG_DOCS_TOKEN" };
const expression = renderMcpSecretsExpression(mcpSecrets)!;

describe("canonical Gateway caller MCP binding", () => {
  it("returns optional installation metadata without changing the unbound caller", () => {
    const options = {
      actionRef: `777genius/review-router@${"a".repeat(40)}`,
      apiUrl: "https://api.reviewrouter.org",
      githubRepositoryId: "123456",
    };
    const absent = renderAccountGatewayWorkflow(options);
    expect(
      renderAccountGatewayWorkflow({ ...options, mcpSecrets: {} }),
    ).toEqual(absent);
    expect(readReviewRouterCallerSource(absent.content)).not.toHaveProperty(
      "mcpSecrets",
    );
    const bound = renderAccountGatewayWorkflow({ ...options, mcpSecrets });
    expect(readReviewRouterCallerSource(bound.content)).toEqual({
      runtimeRef: "workflow-v1",
      controlPlaneUrl: "https://api.reviewrouter.org",
      mcpSecrets,
    });
    expect(readManagedReviewRouterCallerSource(bound.content)).toEqual({
      runtimeRef: "workflow-v1",
      controlPlaneUrl: "https://api.reviewrouter.org",
      modelTransport: "account_gateway",
      mcpSecrets,
    });
  });

  it("refuses inheritance, extra secrets and any expression outside the canonical grammar", () => {
    const source = renderReviewRouterCaller({ mcpSecrets });
    for (const changed of [
      source.replace(
        `    secrets:\n      mcp_secrets_json: ${expression}`,
        "    secrets: inherit",
      ),
      source.replace(expression, "${{ toJSON(secrets) }}"),
      source.replace(expression, "${{ secrets.ORG_DOCS_TOKEN }}"),
      source.replace(
        "toJSON(secrets.ORG_DOCS_TOKEN)",
        "toJSON(secrets['ORG_DOCS_TOKEN'])",
      ),
      `${source}      extra_secret: \${{ secrets.EXTRA }}\n`,
      source.replace("mcp_secrets_json:", "other_secret:"),
    ]) {
      expect(() => readReviewRouterCallerSource(changed)).toThrow();
      expect(() => readManagedReviewRouterCallerSource(changed)).toThrow();
    }
  });
});
