import { randomUUID } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { installGitLabConnectProjects } from "./gitlab-connect";

let prisma: PrismaClient;
vi.mock("./prisma", () => ({ getPrisma: () => prisma }));

const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)(
  "GitLab connect through HTTP and the maintained PostgreSQL schema",
  () => {
    const prefix = `gitlab-connect-${randomUUID()}`;
    const workspaceId = `${prefix}-workspace`;
    const userId = `${prefix}-user`;
    const projectId = String(
      Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16),
    );
    const fullName = `${prefix}/project`;
    const installationToken = "glpat-disposable-installation-credential";
    const reviewToken = "glpat-disposable-project-review-credential";
    const backendToken = "glpat-disposable-shared-backend-credential";
    const requests: {
      method: string;
      path: string;
      headers: IncomingHttpHeaders;
      body: string;
    }[] = [];
    const variables = new Map<string, unknown>();
    let ciConfigPath: string | null = null;
    const project = () => ({
      id: Number(projectId),
      path_with_namespace: fullName,
      default_branch: "main",
      visibility: "private",
      ci_config_path: ciConfigPath,
      permissions: { project_access: { access_level: 40 } },
    });
    const server = createServer((req, res) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks).toString("utf8");
        const method = req.method ?? "";
        const path = req.url ?? "";
        requests.push({ method, path, headers: { ...req.headers }, body });
        const respond = (status: number, value: unknown) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(value));
        };
        if (
          method === "GET" &&
          [
            `/api/v4/projects/${encodeURIComponent(fullName)}`,
            `/api/v4/projects/${projectId}`,
          ].includes(path)
        ) {
          respond(200, project());
        } else if (
          method === "POST" &&
          path === `/api/v4/projects/${projectId}/ci/lint`
        ) {
          respond(200, { valid: true, errors: [] });
        } else if (
          method === "PUT" &&
          path.startsWith(`/api/v4/projects/${projectId}/variables/`)
        ) {
          respond(404, { message: "Not found" });
        } else if (
          method === "POST" &&
          path === `/api/v4/projects/${projectId}/variables`
        ) {
          const value = JSON.parse(body) as Record<string, unknown>;
          if (typeof value.key !== "string")
            throw new Error("fixture_variable_key_missing");
          variables.set(value.key, value);
          respond(201, value);
        } else if (
          method === "PUT" &&
          path === `/api/v4/projects/${projectId}`
        ) {
          const value = JSON.parse(body) as Record<string, unknown>;
          if (typeof value.ci_config_path !== "string")
            throw new Error("fixture_ci_config_path_missing");
          ciConfigPath = value.ci_config_path;
          respond(200, project());
        } else {
          respond(500, { message: "Unexpected fixture request" });
        }
      })().catch(() => res.destroy());
    });

    beforeAll(async () => {
      const url = new URL(databaseUrl!);
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        !/test|e2e/iu.test(url.pathname)
      )
        throw new Error("gitlab_connect_disposable_database_required");
      prisma = createPrismaClient({ databaseUrl: databaseUrl!, poolMax: 2 });
      await prisma.$transaction([
        prisma.user.create({ data: { id: userId } }),
        prisma.workspace.create({
          data: { id: workspaceId, slug: prefix, name: prefix },
        }),
      ]);
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("gitlab_connect_fixture_address_missing");
      vi.stubEnv(
        "REVIEW_ROUTER_GITLAB_API_BASE_URL",
        `http://127.0.0.1:${address.port}/api/v4`,
      );
      vi.stubEnv("GITLAB_OAUTH_BASE_URL", "https://gitlab.com");
      vi.stubEnv("REVIEW_ROUTER_GITLAB_API_TOKEN", backendToken);
      vi.stubEnv("REVIEW_ROUTER_GITLAB_OIDC_AUDIENCE", "reviewrouter-test");
      vi.stubEnv(
        "REVIEW_ROUTER_PUBLIC_API_URL",
        "https://api.reviewrouter.test",
      );
    });

    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      vi.unstubAllEnvs();
      if (prisma) {
        await prisma.workspace.deleteMany({ where: { id: workspaceId } });
        await prisma.user.deleteMany({ where: { id: userId } });
        await prisma.$disconnect();
      }
    });

    it("persists a working installation while writing only the separate project credential to CI", async () => {
      const input = {
        sourceUrl: `https://gitlab.com/${fullName}`,
        token: installationToken,
        reviewToken,
        workspaceId,
        selectedProjectIds: [projectId],
        installedByUserId: userId,
      };
      const result = await installGitLabConnectProjects(input);
      expect(result).toMatchObject({
        namespacePath: prefix,
        requested: 1,
        succeeded: 1,
        failed: 0,
        results: [
          {
            projectId,
            status: "fulfilled",
            result: { mode: "ci_config_path", variablesConfigured: 3 },
          },
        ],
      });
      expect(ciConfigPath).toContain("reviewrouter");
      expect([...variables.keys()].sort()).toEqual([
        "REVIEWROUTER_API_URL",
        "REVIEWROUTER_GITLAB_TOKEN",
        "REVIEWROUTER_ID_TOKEN_AUDIENCE",
      ]);
      expect(variables.get("REVIEWROUTER_GITLAB_TOKEN")).toEqual({
        key: "REVIEWROUTER_GITLAB_TOKEN",
        value: reviewToken,
        masked: true,
        protected: false,
        raw: true,
        variable_type: "env_var",
      });
      for (const request of requests) {
        const { "private-token": privateToken, ...headers } = request.headers;
        expect(privateToken).toBe(installationToken);
        expect(JSON.stringify({ ...request, headers })).not.toContain(
          installationToken,
        );
      }
      expect(JSON.stringify(requests)).not.toContain(backendToken);

      const installation = await prisma.gitLabInstallation.findUniqueOrThrow({
        where: { id: result.installationId },
      });
      const repository = await prisma.repositoryConnection.findUniqueOrThrow({
        where: {
          provider_externalRepositoryId_sourceBaseUrl: {
            provider: "gitlab",
            externalRepositoryId: projectId,
            sourceBaseUrl: "https://gitlab.com",
          },
        },
      });
      expect(installation).toMatchObject({
        workspaceId,
        installedByUserId: userId,
        sourceKind: "project",
        status: "active",
        selectedProjects: 1,
      });
      expect(repository).toMatchObject({
        workspaceId,
        gitlabInstallationId: installation.id,
        selected: true,
        fullName,
        setupStatus: "configured",
      });
      const persisted = JSON.stringify(
        { installation, repository },
        (_key, value: unknown) =>
          typeof value === "bigint" ? value.toString() : value,
      );
      for (const secret of [backendToken, installationToken, reviewToken]) {
        expect(persisted).not.toContain(secret);
        expect(JSON.stringify(result)).not.toContain(secret);
      }

      const requestCount = requests.length;
      for (const forbiddenToken of [installationToken, backendToken, ""]) {
        await expect(
          installGitLabConnectProjects({
            ...input,
            reviewToken: forbiddenToken,
          }),
        ).rejects.toThrow(
          forbiddenToken
            ? "gitlab_review_token_must_be_separate"
            : "gitlab_review_token_missing",
        );
      }
      expect(requests).toHaveLength(requestCount);
      expect(
        await prisma.gitLabInstallation.count({ where: { workspaceId } }),
      ).toBe(1);
    });
  },
);
