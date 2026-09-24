import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HostedV4AuthorityBridge } from "@reviewrouter/features-hosted-account-pool";
import type { HostedV4ScmReadGateway } from "./github/hosted-v4-scm-read-gateway.js";

const admission = z.strictObject({
  authorizationToken: z.string().min(1).max(4096),
  repositoryConnectionId: z.string().min(1).max(256),
  providerInstanceId: z.string().min(1).max(256),
  bindingId: z.string().min(1).max(256),
  bindingVersion: z.number().int().positive(),
});
const renewal = z.strictObject({
  capability: z.string().min(1).max(4096),
  authorizationToken: z.string().min(1).max(4096),
});
const fileRead = z.strictObject({
  capability: z.string().min(1).max(4096),
  path: z.string().min(1).max(1024),
});

export type HostedV4ReadRoutesDependencies = Readonly<{
  enabled: boolean;
  bridge?: HostedV4AuthorityBridge;
  scm?: Pick<HostedV4ScmReadGateway, "readFile">;
}>;

/** Private server route. An enabled v4 failure never falls through to v1/v2. */
export async function registerHostedV4ReadRoutes(
  app: FastifyInstance,
  dependencies: HostedV4ReadRoutesDependencies,
): Promise<void> {
  if (!dependencies.enabled) return;
  if (!dependencies.bridge || !dependencies.scm)
    throw new Error("hosted_v4_read_dependencies_unavailable");
  const bridge = dependencies.bridge;
  const scm = dependencies.scm;
  const options = { bodyLimit: 8 * 1024 };
  app.post(
    "/api/hosted/v4/read-capabilities",
    options,
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const parsed = admission.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "invalid_request" });
      try {
        const issued = await bridge.admit(parsed.data);
        return reply.code(201).send({
          capability: issued.capability,
          expiresAt: issued.scope.expiresAt,
        });
      } catch {
        return reply.code(403).send({ error: "hosted_v4_authority_denied" });
      }
    },
  );
  app.post(
    "/api/hosted/v4/read-capabilities/refresh",
    options,
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const parsed = renewal.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "invalid_request" });
      try {
        const issued = await bridge.refresh(
          parsed.data.capability,
          parsed.data.authorizationToken,
        );
        return reply.code(200).send({
          capability: issued.capability,
          expiresAt: issued.scope.expiresAt,
        });
      } catch {
        return reply.code(403).send({ error: "hosted_v4_authority_denied" });
      }
    },
  );
  app.post("/api/hosted/v4/files/read", options, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const parsed = fileRead.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "invalid_request" });
    try {
      const scope = await bridge.resolveRead(parsed.data.capability);
      const file = await scm.readFile(scope, parsed.data.path);
      await bridge.resolveRead(parsed.data.capability);
      return reply.code(200).send(file);
    } catch {
      return reply.code(403).send({ error: "hosted_v4_read_denied" });
    }
  });
}
