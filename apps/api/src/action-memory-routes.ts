import type { FastifyInstance } from "fastify";

/** Historical injection input is accepted only to keep callers on the explicit fence. */
export type RegisterActionMemoryRoutesDependencies = unknown;

/** V1 has no current-source authority or immutable admission receipt. Never execute it. */
export async function registerActionMemoryRoutes(
  app: FastifyInstance,
  _dependencies?: RegisterActionMemoryRoutesDependencies,
): Promise<void> {
  void _dependencies;
  for (const [method, url] of [
    ["GET", "/api/action/v1/memory"],
    ["POST", "/api/action/v1/memory-candidates"],
    ["POST", "/api/action/v1/memory-commands"],
  ] as const) {
    app.route({
      method,
      url,
      bodyLimit: 1_024,
      logLevel: "silent",
      handler: async (_request, reply) => {
        reply.header("cache-control", "private, no-store");
        return reply.code(410).send({
          protocolVersion: 1,
          status: "rejected",
          reason: "memory_protocol_retired",
          retryable: false,
        });
      },
    });
  }
}
