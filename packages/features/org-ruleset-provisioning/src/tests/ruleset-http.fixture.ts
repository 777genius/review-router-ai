import { createServer } from "node:http";
import { once } from "node:events";
import { z } from "zod";

const envelopeSchema = z.object({
  route: z.string(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

/** Real HTTP transport with deterministic GitHub response-loss/concurrency faults. */
export async function rulesetHttpFixture() {
  let workflow: string | null = null;
  let ruleset: Record<string, unknown> | null = null;
  let nextCreate: "normal" | "apply_then_disconnect" | "disconnect" | "reject" =
    "normal";
  let createCount = 0;
  let updateCount = 0;
  let pause: { entered: () => void; released: Promise<void> } | undefined;
  let pauseCreate: { entered: () => void; released: Promise<void> } | undefined;
  const server = createServer(async (request, response) => {
    try {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const { route, parameters = {} } = envelopeSchema.parse(JSON.parse(body));
      const reply = (status: number, value: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };
      const remoteRuleset = () => ({
        ...parameters,
        id: 77,
        _links: { html: { href: "https://github.com/orgs/example/rules/77" } },
      });
      if (route === "GET /repos/{owner}/{repo}/contents/{path}") {
        return workflow === null
          ? reply(404, { message: "not found" })
          : reply(200, {
              type: "file",
              sha: "workflow-sha",
              content: Buffer.from(workflow).toString("base64"),
            });
      }
      if (route === "PUT /repos/{owner}/{repo}/contents/{path}") {
        workflow = Buffer.from(String(parameters.content), "base64").toString();
        return reply(200, { content: { sha: "workflow-sha" } });
      }
      if (route === "GET /orgs/{org}/rulesets")
        return reply(200, ruleset ? [ruleset] : []);
      if (route === "GET /orgs/{org}/rulesets/{ruleset_id}")
        return reply(ruleset ? 200 : 404, ruleset);
      if (route === "POST /orgs/{org}/rulesets") {
        createCount += 1;
        const gate = pauseCreate;
        pauseCreate = undefined;
        if (gate) {
          gate.entered();
          await gate.released;
        }
        const fault = nextCreate;
        nextCreate = "normal";
        if (fault === "reject")
          return reply(422, { message: "validation failed" });
        if (fault !== "disconnect") ruleset = remoteRuleset();
        if (fault === "disconnect" || fault === "apply_then_disconnect") {
          request.socket.destroy();
          return;
        }
        return reply(201, ruleset);
      }
      if (route === "PUT /orgs/{org}/rulesets/{ruleset_id}") {
        updateCount += 1;
        const gate = pause;
        pause = undefined;
        if (gate) {
          gate.entered();
          await gate.released;
        }
        ruleset = remoteRuleset();
        return reply(200, ruleset);
      }
      return reply(404, { message: `unexpected fixture route ${route}` });
    } catch {
      response.writeHead(500);
      response.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fixture_http_address_missing");
  return {
    get ruleset() {
      return ruleset;
    },
    get createCount() {
      return createCount;
    },
    get updateCount() {
      return updateCount;
    },
    failNextCreate(fault: typeof nextCreate) {
      nextCreate = fault;
    },
    holdNextCreate() {
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      pauseCreate = { entered: enter, released };
      return { entered, release };
    },
    holdNextUpdate() {
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      pause = { entered: enter, released };
      return { entered, release };
    },
    requester: {
      async request(
        route: string,
        parameters?: Record<string, unknown>,
      ): Promise<{ data: unknown }> {
        const options = parameters?.request;
        const signal =
          options !== null &&
          typeof options === "object" &&
          "signal" in options &&
          options.signal instanceof AbortSignal
            ? options.signal
            : undefined;
        const response = await fetch(`http://127.0.0.1:${address.port}`, {
          method: "POST",
          body: JSON.stringify({ route, parameters }),
          ...(signal ? { signal } : {}),
        });
        if (!response.ok)
          throw Object.assign(new Error("fixture_github_response_error"), {
            status: response.status,
          });
        return { data: await response.json() };
      },
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
