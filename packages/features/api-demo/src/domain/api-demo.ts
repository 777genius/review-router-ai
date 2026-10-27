export type ApiDemoEndpoint = {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly purpose: string;
  readonly auth:
    | "public"
    | "github_webhook_signature"
    | "github_actions_oidc_session";
};

export type ApiDemoProvider = {
  readonly id:
    | "codex_oauth_rotating"
    | "claude_code_oauth"
    | "openrouter_api_key";
  readonly label: string;
  readonly secretLocation: "github_actions_secret";
  readonly sentToSaas: false;
};

export type ApiDemoQuickStartStep = {
  readonly order: number;
  readonly title: string;
  readonly description: string;
  readonly command?: string;
};

export type ApiDemoSecurityBoundary = {
  readonly topic: string;
  readonly guarantee: string;
};

export type ApiDemoSampleRequest = {
  readonly title: string;
  readonly command: string;
  readonly expectedSignal: string;
};

export type ApiDemoMaturity = {
  readonly stage: "hosted_beta";
  readonly readyFor: readonly string[];
  readonly knownLimitations: readonly string[];
};

export type ApiDemoIndexDocument = {
  readonly service: "review-router-api";
  readonly product: "ReviewRouter";
  readonly status: "ok";
  readonly summary: string;
  readonly links: {
    readonly health: string;
    readonly ready: string;
    readonly demo: string;
    readonly demoMarkdown: string;
    readonly openapi: string;
    readonly apiDocs: string;
    readonly dashboard: string;
    readonly docs: string;
  };
};

export type ApiDemoDocument = {
  readonly service: "review-router-api";
  readonly product: "ReviewRouter";
  readonly contractVersion: "2026-05-04";
  readonly status: "demo_ready";
  readonly checkedAt: Date;
  readonly summary: string;
  readonly executionModel: {
    readonly reviewRunsIn: "customer_github_actions";
    readonly controlPlaneStores: readonly string[];
    readonly controlPlaneDoesNotStore: readonly string[];
  };
  readonly defaultReviewRuntime: {
    readonly actionVersion: string;
    readonly model: string;
    readonly effort: string;
    readonly provider: "codex_oauth_rotating";
  };
  readonly providers: readonly ApiDemoProvider[];
  readonly endpoints: readonly ApiDemoEndpoint[];
  readonly quickStart: readonly ApiDemoQuickStartStep[];
  readonly sampleRequests: readonly ApiDemoSampleRequest[];
  readonly securityBoundaries: readonly ApiDemoSecurityBoundary[];
  readonly maturity: ApiDemoMaturity;
  readonly links: {
    readonly dashboard: string;
    readonly gettingStarted: string;
    readonly docs: string;
    readonly openapi: string;
    readonly apiDocs: string;
    readonly demoMarkdown: string;
  };
};

export function buildApiDemoIndex(input: {
  readonly webUrl: string;
  readonly apiUrl: string;
}): ApiDemoIndexDocument {
  return {
    service: "review-router-api",
    product: "ReviewRouter",
    status: "ok",
    summary: "Public API entrypoint for the ReviewRouter hosted control plane.",
    links: {
      health: `${input.apiUrl}/health`,
      ready: `${input.apiUrl}/ready`,
      demo: `${input.apiUrl}/demo`,
      demoMarkdown: `${input.apiUrl}/demo.md`,
      openapi: `${input.apiUrl}/openapi.json`,
      apiDocs: `${input.apiUrl}/docs`,
      dashboard: `${input.webUrl}/dashboard`,
      docs: "https://github.com/777genius/review-router",
    },
  };
}

export function buildApiDemoDocument(input: {
  readonly checkedAt: Date;
  readonly webUrl: string;
  readonly apiUrl: string;
  readonly actionVersion: string;
  readonly model: string;
  readonly effort: string;
}): ApiDemoDocument {
  return {
    service: "review-router-api",
    product: "ReviewRouter",
    contractVersion: "2026-05-04",
    status: "demo_ready",
    checkedAt: input.checkedAt,
    summary:
      "Hosted control plane for ReviewRouter. Repository code review still runs inside the customer's GitHub Actions workflow.",
    executionModel: {
      reviewRunsIn: "customer_github_actions",
      controlPlaneStores: [
        "GitHub installation metadata",
        "selected repositories",
        "review policy/configuration",
        "workflow setup state",
        "safe action health telemetry",
        "audit and outbox events",
      ],
      controlPlaneDoesNotStore: [
        "repository source code",
        "pull request diffs",
        "model prompts or responses by default",
        "Codex OAuth rotating auth.json",
        "Claude Code OAuth token",
        "provider API keys",
      ],
    },
    defaultReviewRuntime: {
      actionVersion: input.actionVersion,
      model: input.model,
      effort: input.effort,
      provider: "codex_oauth_rotating",
    },
    providers: [
      {
        id: "codex_oauth_rotating",
        label:
          "Codex CLI with ChatGPT subscription OAuth and GitHub-hosted refresh",
        secretLocation: "github_actions_secret",
        sentToSaas: false,
      },
      {
        id: "claude_code_oauth",
        label: "Claude Code subscription OAuth",
        secretLocation: "github_actions_secret",
        sentToSaas: false,
      },
      {
        id: "openrouter_api_key",
        label: "OpenRouter API key mode",
        secretLocation: "github_actions_secret",
        sentToSaas: false,
      },
    ],
    endpoints: [
      {
        method: "GET",
        path: "/health",
        purpose: "Liveness plus dependency health.",
        auth: "public",
      },
      {
        method: "GET",
        path: "/ready",
        purpose:
          "Small readiness response for demos, uptime checks, and smoke tests.",
        auth: "public",
      },
      {
        method: "GET",
        path: "/demo",
        purpose: "Human-readable API capability summary for the hosted beta.",
        auth: "public",
      },
      {
        method: "GET",
        path: "/demo.md",
        purpose: "Terminal-friendly Markdown API demo summary.",
        auth: "public",
      },
      {
        method: "GET",
        path: "/openapi.json",
        purpose: "Machine-readable API surface for public demo endpoints.",
        auth: "public",
      },
      {
        method: "GET",
        path: "/docs",
        purpose:
          "Browser-friendly hosted API demo page for humans and screenshots.",
        auth: "public",
      },
      {
        method: "POST",
        path: "/webhooks/github",
        purpose: "GitHub App lifecycle webhooks for installation sync.",
        auth: "github_webhook_signature",
      },
      {
        method: "POST",
        path: "/api/action/v1/session/exchange",
        purpose:
          "GitHub Actions OIDC token exchange for runtime config access.",
        auth: "github_actions_oidc_session",
      },
      {
        method: "GET",
        path: "/api/action/v1/config",
        purpose: "Review runtime configuration fetched by the GitHub Action.",
        auth: "github_actions_oidc_session",
      },
      {
        method: "POST",
        path: "/api/action/v2/memory/bundle",
        purpose:
          "Approved repository and workspace knowledge for an authorized review run.",
        auth: "github_actions_oidc_session",
      },
      {
        method: "POST",
        path: "/api/action/v2/memory/admit",
        purpose:
          "Validate the captured memory snapshot before requesting a review invocation.",
        auth: "github_actions_oidc_session",
      },
      {
        method: "POST",
        path: "/api/action/v2/memory/candidates",
        purpose:
          "Save an explicit distilled statement after checking the current GitHub source and author.",
        auth: "github_actions_oidc_session",
      },
      {
        method: "POST",
        path: "/api/action/v2/memory/commands",
        purpose:
          "Update, stop using, request removal, or check the status of a memory operation.",
        auth: "github_actions_oidc_session",
      },
      {
        method: "POST",
        path: "/api/action/v1/health-report",
        purpose: "Safe metadata-only action health telemetry.",
        auth: "github_actions_oidc_session",
      },
    ],
    quickStart: [
      {
        order: 1,
        title: "Install the GitHub App",
        description:
          "Connect ReviewRouter to selected repositories from the dashboard.",
      },
      {
        order: 2,
        title: "Choose provider credentials",
        description:
          "Store Codex OAuth rotating, Claude Code OAuth, or OpenRouter API credentials in GitHub Actions secrets. The hosted control plane does not receive those credentials.",
      },
      {
        order: 3,
        title: "Provision the workflow",
        description:
          "Create a small GitHub Actions workflow that calls the ReviewRouter Action and fetches metadata-only runtime config from this API.",
      },
      {
        order: 4,
        title: "Open a pull request",
        description:
          "Review comments are posted from the installed GitHub App while model execution remains inside the repository workflow.",
      },
    ],
    sampleRequests: [
      {
        title: "Check service health",
        command: `curl -fsS ${input.apiUrl}/health | jq .`,
        expectedSignal: "status is ok and database dependency is ok",
      },
      {
        title: "Inspect demo contract",
        command: `curl -fsS ${input.apiUrl}/demo | jq .`,
        expectedSignal:
          "executionModel.reviewRunsIn is customer_github_actions",
      },
      {
        title: "Inspect OpenAPI metadata",
        command: `curl -fsS ${input.apiUrl}/openapi.json | jq .info`,
        expectedSignal: "OpenAPI document title is ReviewRouter API",
      },
      {
        title: "Open the browser demo",
        command: `open ${input.apiUrl}/docs`,
        expectedSignal:
          "HTML page explains quick start and security boundaries",
      },
    ],
    securityBoundaries: [
      {
        topic: "Repository code",
        guarantee:
          "Pull request diffs and source files are reviewed in the customer's GitHub Actions job, not uploaded to the SaaS control plane by default.",
      },
      {
        topic: "Provider credentials",
        guarantee:
          "Codex OAuth rotating auth.json, Claude Code OAuth tokens, and provider API keys remain GitHub Actions secrets owned by the target repository or organization.",
      },
      {
        topic: "Runtime access",
        guarantee:
          "Workflow runtime config access uses GitHub Actions OIDC and short-lived ReviewRouter action sessions.",
      },
      {
        topic: "Telemetry",
        guarantee:
          "Health reports are metadata-only and intended for setup diagnostics, not model prompt or response storage.",
      },
    ],
    maturity: {
      stage: "hosted_beta",
      readyFor: [
        "dashboard walkthrough",
        "API smoke demo",
        "selected repository beta installs",
        "metadata-only action control-plane demo",
      ],
      knownLimitations: [
        "GitHub App lifecycle events must be enabled in the App settings before full install sync works.",
        "Hosted production should use the stable ReviewRouter v1 action channel, with full-SHA refs kept only for rollback allowlists.",
      ],
    },
    links: {
      dashboard: `${input.webUrl}/dashboard`,
      gettingStarted: `${input.webUrl}/getting-started`,
      docs: "https://github.com/777genius/review-router",
      openapi: `${input.apiUrl}/openapi.json`,
      apiDocs: `${input.apiUrl}/docs`,
      demoMarkdown: `${input.apiUrl}/demo.md`,
    },
  };
}

export function buildApiDemoOpenApiDocument(input: {
  readonly apiUrl: string;
}): Record<string, unknown> {
  const jsonResponseHeaders = {
    "Access-Control-Allow-Origin": {
      schema: { type: "string", const: "*" },
      description: "Public demo endpoints are browser-readable.",
    },
    "Cache-Control": {
      schema: { type: "string", const: "no-store" },
      description:
        "Demo responses are generated from current deployment config.",
    },
    "X-ReviewRouter-Demo": {
      schema: { type: "string", const: "true" },
      description: "Marks intentionally public demo endpoints.",
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "ReviewRouter API",
      version: "2026-05-04",
      summary:
        "Hosted control-plane API for ReviewRouter. Reviews run in customer GitHub Actions.",
    },
    servers: [{ url: input.apiUrl }],
    paths: {
      "/": {
        get: {
          summary: "API index",
          responses: {
            "200": {
              description: "Public ReviewRouter API index.",
              headers: jsonResponseHeaders,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApiIndex" },
                  examples: {
                    hosted: {
                      value: buildApiDemoIndex({
                        webUrl: "https://reviewrouter.org",
                        apiUrl: input.apiUrl,
                      }),
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/health": {
        get: {
          summary: "Service and dependency health",
          responses: {
            "200": {
              description: "Service is healthy.",
              headers: jsonResponseHeaders,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/HealthResponse" },
                },
              },
            },
          },
        },
      },
      "/ready": {
        get: {
          summary: "Compact readiness check",
          responses: {
            "200": {
              description: "Service is ready.",
              headers: jsonResponseHeaders,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ReadyResponse" },
                  examples: {
                    ready: {
                      value: {
                        service: "review-router-api",
                        status: "ready",
                        checkedAt: "2026-05-04T00:00:00.000Z",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/demo": {
        get: {
          summary: "Public hosted beta capability summary",
          responses: {
            "200": {
              description: "ReviewRouter hosted beta demo document.",
              headers: jsonResponseHeaders,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApiDemo" },
                  examples: {
                    hosted: {
                      value: {
                        ...buildApiDemoDocument({
                          checkedAt: new Date("2026-05-04T00:00:00.000Z"),
                          webUrl: "https://reviewrouter.org",
                          apiUrl: input.apiUrl,
                          actionVersion:
                            "777genius/review-router@0123456789abcdef0123456789abcdef01234567",
                          model: "gpt-5.5",
                          effort: "xhigh",
                        }),
                        checkedAt: "2026-05-04T00:00:00.000Z",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/demo.md": {
        get: {
          summary: "Markdown API demo summary",
          responses: {
            "200": {
              description: "Terminal-friendly Markdown ReviewRouter API demo.",
              headers: jsonResponseHeaders,
              content: {
                "text/markdown": {
                  schema: { type: "string" },
                },
              },
            },
          },
        },
      },
      "/openapi.json": {
        get: {
          summary: "OpenAPI document",
          responses: {
            "200": {
              description: "OpenAPI 3.1 document.",
              headers: jsonResponseHeaders,
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
      },
      "/docs": {
        get: {
          summary: "Browser-friendly API demo page",
          responses: {
            "200": {
              description: "HTML ReviewRouter API demo page.",
              headers: jsonResponseHeaders,
              content: {
                "text/html": {
                  schema: { type: "string" },
                },
              },
            },
          },
        },
      },
      "/webhooks/github": {
        post: {
          summary: "GitHub App lifecycle webhook",
          security: [{ githubWebhookSignature: [] }],
          responses: {
            "202": { description: "Webhook accepted." },
            "401": { description: "Invalid GitHub webhook signature." },
          },
        },
      },
      "/api/action/v1/session/exchange": {
        post: {
          summary: "GitHub Actions OIDC exchange",
          security: [{ githubActionsOidc: [] }],
          responses: {
            "200": { description: "Short-lived action session issued." },
            "401": { description: "Invalid GitHub Actions OIDC token." },
          },
        },
      },
      "/api/action/v1/config": {
        get: {
          summary: "Runtime review configuration",
          security: [{ reviewRouterActionSession: [] }],
          responses: {
            "200": { description: "Repository runtime config." },
            "401": { description: "Invalid action session." },
          },
        },
      },
      "/api/action/v1/memory": {
        get: {
          deprecated: true,
          summary: "Retired memory protocol",
          description:
            "This route is permanently fenced. It does not retrieve or change memory. Use the v2 memory routes.",
          responses: {
            "410": {
              description: "Memory protocol retired; no operation executed.",
            },
          },
        },
      },
      "/api/action/v1/memory-candidates": {
        post: {
          deprecated: true,
          summary: "Retired memory protocol",
          description:
            "This route is permanently fenced. It does not retrieve or change memory. Use the v2 memory routes.",
          responses: {
            "410": {
              description: "Memory protocol retired; no operation executed.",
            },
          },
        },
      },
      "/api/action/v1/memory-commands": {
        post: {
          deprecated: true,
          summary: "Retired memory protocol",
          description:
            "This route is permanently fenced. It does not retrieve or change memory. Use the v2 memory routes.",
          responses: {
            "410": {
              description: "Memory protocol retired; no operation executed.",
            },
          },
        },
      },
      "/api/action/v2/memory/bundle": {
        post: {
          summary: "Capture approved review knowledge",
          description:
            "Requires the current authorized review run, repository, commit, and plan revision. Uses a fixed server-side retrieval query; arbitrary query text is not accepted. Returns an immutable snapshot and a short-lived receipt.",
          security: [{ reviewRouterActionSession: [] }],
          responses: {
            "200": {
              description:
                "Captured memory bundle or an explicit unavailable response.",
            },
            "400": { description: "Invalid bounded memory payload." },
            "401": { description: "Invalid action session." },
            "403": { description: "Current memory authority unavailable." },
          },
        },
      },
      "/api/action/v2/memory/admit": {
        post: {
          summary: "Validate a captured memory snapshot",
          description:
            "Checks current scope, source, policy, and revision authority. The invocation lease performs the authoritative check atomically before charging an attempt.",
          security: [{ reviewRouterActionSession: [] }],
          responses: {
            "200": {
              description:
                "Current admission decision for the supplied memory receipt.",
            },
            "400": { description: "Invalid bounded memory payload." },
            "401": { description: "Invalid action session." },
            "403": { description: "Current memory authority unavailable." },
          },
        },
      },
      "/api/action/v2/memory/candidates": {
        post: {
          summary: "Save an explicit memory statement",
          description:
            "Accepts a distilled statement of at most 1000 characters, an idempotent command ID, and verifiable GitHub source metadata. Current stable actor identity and repository or workspace permission are required. Does not accept raw conversations, code, diffs, or model output.",
          security: [{ reviewRouterActionSession: [] }],
          responses: {
            "200": {
              description:
                "Durable operation status. Acceptance does not imply publication.",
            },
            "400": { description: "Invalid bounded memory payload." },
            "401": { description: "Invalid action session." },
            "403": { description: "Current memory authority unavailable." },
          },
        },
      },
      "/api/action/v2/memory/commands": {
        post: {
          summary: "Manage a memory entry or operation",
          description:
            "Updates an existing entry with its expected revision, stops using it, requests removal, or retrieves operation status. Mutations use command IDs and compare-and-set revisions. Removal remains pending until cleanup is verified.",
          security: [{ reviewRouterActionSession: [] }],
          responses: {
            "200": {
              description:
                "Operation results with honest queued, published, revoked, or cleanup status.",
            },
            "400": { description: "Invalid bounded memory payload." },
            "401": { description: "Invalid action session." },
            "403": { description: "Current memory authority unavailable." },
          },
        },
      },
      "/api/action/v2/memory/entries/{id}": {
        get: {
          summary: "Read an entry for an authorized memory command",
          description:
            "Requires current source metadata and management permission. An original command ID can recover the same compare-and-set revision for a retry.",
          security: [{ reviewRouterActionSession: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description:
                "Current entry and original command revision when requested.",
            },
            "400": { description: "Invalid entry or source metadata." },
            "401": { description: "Invalid action session." },
            "403": { description: "Current management authority unavailable." },
          },
        },
      },
      "/api/action/v1/health-report": {
        post: {
          summary: "Metadata-only action health report",
          security: [{ reviewRouterActionSession: [] }],
          responses: {
            "202": { description: "Health report accepted." },
            "401": { description: "Invalid action session." },
          },
        },
      },
    },
    components: {
      schemas: {
        ApiIndex: {
          type: "object",
          required: ["service", "product", "status", "summary", "links"],
          properties: {
            service: { type: "string", const: "review-router-api" },
            product: { type: "string", const: "ReviewRouter" },
            status: { type: "string", const: "ok" },
            summary: { type: "string" },
            links: {
              type: "object",
              required: [
                "health",
                "ready",
                "demo",
                "demoMarkdown",
                "openapi",
                "apiDocs",
                "dashboard",
                "docs",
              ],
              additionalProperties: false,
              properties: {
                health: { type: "string", format: "uri" },
                ready: { type: "string", format: "uri" },
                demo: { type: "string", format: "uri" },
                demoMarkdown: { type: "string", format: "uri" },
                openapi: { type: "string", format: "uri" },
                apiDocs: { type: "string", format: "uri" },
                dashboard: { type: "string", format: "uri" },
                docs: { type: "string", format: "uri" },
              },
            },
          },
        },
        ReadyResponse: {
          type: "object",
          required: ["service", "status", "checkedAt"],
          properties: {
            service: { type: "string", const: "review-router-api" },
            status: { type: "string", const: "ready" },
            checkedAt: { type: "string", format: "date-time" },
          },
        },
        HealthResponse: {
          type: "object",
          required: ["service", "status", "checkedAt"],
          properties: {
            service: { type: "string", const: "review-router-api" },
            status: { type: "string", enum: ["ok", "degraded"] },
            checkedAt: { type: "string", format: "date-time" },
            dependencies: {
              type: "array",
              items: {
                type: "object",
                required: ["name", "status"],
                properties: {
                  name: { type: "string" },
                  status: { type: "string", enum: ["ok", "degraded"] },
                },
              },
            },
          },
        },
        ApiDemo: {
          type: "object",
          required: [
            "service",
            "product",
            "contractVersion",
            "status",
            "checkedAt",
            "summary",
            "executionModel",
            "defaultReviewRuntime",
            "providers",
            "endpoints",
            "quickStart",
            "sampleRequests",
            "securityBoundaries",
            "maturity",
            "links",
          ],
          properties: {
            service: { type: "string", const: "review-router-api" },
            product: { type: "string", const: "ReviewRouter" },
            contractVersion: { type: "string", const: "2026-05-04" },
            status: { type: "string", const: "demo_ready" },
            checkedAt: { type: "string", format: "date-time" },
            summary: { type: "string" },
            executionModel: { type: "object" },
            defaultReviewRuntime: { type: "object" },
            providers: { type: "array", items: { type: "object" } },
            endpoints: { type: "array", items: { type: "object" } },
            quickStart: { type: "array", items: { type: "object" } },
            sampleRequests: { type: "array", items: { type: "object" } },
            securityBoundaries: { type: "array", items: { type: "object" } },
            maturity: { type: "object" },
            links: { type: "object" },
          },
        },
      },
      securitySchemes: {
        githubWebhookSignature: {
          type: "apiKey",
          in: "header",
          name: "x-hub-signature-256",
        },
        githubActionsOidc: {
          type: "http",
          scheme: "bearer",
          description: "GitHub Actions OIDC JWT.",
        },
        reviewRouterActionSession: {
          type: "http",
          scheme: "bearer",
          description:
            "Short-lived ReviewRouter session returned by the OIDC exchange endpoint.",
        },
      },
    },
  };
}
