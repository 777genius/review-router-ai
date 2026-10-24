import { createServer } from "node:http";
import { generateKeyPairSync, randomBytes, verify } from "node:crypto";
import { once } from "node:events";
export const SKILLS_MANAGER_EXTERNAL_ID = "910000000003";
export async function startSkillsGitHubFixture() {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKey = pair.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const token = `rr-e2e-installation-${randomBytes(20).toString("hex")}`;
  const requests: { method: string; path: string }[] = [];
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    requests.push({ method: request.method ?? "", path });
    const json = (status: number, value: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (
      request.method === "POST" &&
      /^\/app\/installations\/\d+\/access_tokens$/.test(path)
    ) {
      const jwt = request.headers.authorization?.replace(/^bearer /i, "") ?? "";
      const [header, payload, signature] = jwt.split(".");
      let claims: { iss?: string; exp?: number } = {};
      try {
        claims = JSON.parse(Buffer.from(payload ?? "", "base64url").toString());
      } catch {
        /* refuse below */
      }
      if (
        !header ||
        !payload ||
        !signature ||
        claims.iss !== "990001" ||
        !claims.exp ||
        claims.exp < Date.now() / 1000 ||
        !verify(
          "RSA-SHA256",
          Buffer.from(`${header}.${payload}`),
          pair.publicKey,
          Buffer.from(signature, "base64url"),
        )
      )
        return json(401, { message: "Invalid fixture App JWT" });
      for await (const chunk of request) void chunk;
      return json(201, {
        token,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        permissions: { metadata: "read", contents: "read" },
        repository_selection: "selected",
      });
    }
    if (
      request.method === "GET" &&
      /^\/repos\/rr-e2e-org-alpha\/skills-project-001\/collaborators\/rr-e2e-foreign-person\/permission$/.test(
        path,
      )
    ) {
      if (
        request.headers.authorization !== `token ${token}` &&
        request.headers.authorization !== `Bearer ${token}`
      )
        return json(401, { message: "Wrong fixture installation token" });
      return json(200, {
        permission: "write",
        role_name: "write",
        user: {
          id: Number(SKILLS_MANAGER_EXTERNAL_ID),
          login: "rr-e2e-foreign-person",
        },
      });
    }
    json(404, { message: "No fixture permission" });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("skills_github_fixture_address");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    privateKey,
    requests,
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
