import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

const claimCanary = "codex_claim_11111111-1111-4111-8111-111111111111";
const httpServers: Array<ReturnType<typeof createHttpServer>> = [];

afterEach(async () => {
  await Promise.all(
    httpServers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

describe("rotating installer continuation curl boundary", () => {
  it.each([307, 308])(
    "does not follow an HTTP %s or ambient curl URL with a claim body",
    async (redirectStatus) => {
      let trustedRequests = 0;
      let crossOriginRequests = 0;
      const trustedBodies: string[] = [];
      const crossOrigin = createHttpServer((request, response) => {
        crossOriginRequests += 1;
        request.resume();
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"status":"prepared"}');
      });
      httpServers.push(crossOrigin);
      await listenOnLoopback(crossOrigin);
      const crossOriginAddress = crossOrigin.address();
      if (!crossOriginAddress || typeof crossOriginAddress === "string") {
        throw new Error("cross-origin test server did not bind a TCP port");
      }
      const crossOriginUrl = `http://127.0.0.1:${crossOriginAddress.port}`;

      const trustedOrigin = createHttpServer((request, response) => {
        trustedRequests += 1;
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => (body += chunk));
        request.on("end", () => {
          trustedBodies.push(body);
          response.writeHead(redirectStatus, {
            location: `${crossOriginUrl}/redirect-target`,
          });
          response.end();
        });
      });
      httpServers.push(trustedOrigin);
      await listenOnLoopback(trustedOrigin);
      const trustedAddress = trustedOrigin.address();
      if (!trustedAddress || typeof trustedAddress === "string") {
        throw new Error("trusted test server did not bind a TCP port");
      }
      const trustedUrl = `http://127.0.0.1:${trustedAddress.port}`;

      const root = mkdtempSync(join(tmpdir(), "rr-ledger-redirect-"));
      const journal = join(root, "journal.json");
      writeFileSync(journal, JSON.stringify({ claimId: claimCanary }), {
        mode: 0o600,
      });
      writeFileSync(
        join(root, ".curlrc"),
        [
          "verbose",
          'trace-ascii = "-"',
          `url = "${crossOriginUrl}/ambient-curlrc-transfer"`,
          "",
        ].join("\n"),
      );
      const script = join(process.cwd(), "scripts/seed-codex-rotating-auth.sh");
      const child = spawn(
        "/bin/bash",
        [
          "-c",
          'source "$1"; SETUP_URL="$2/manifest"; SETUP_PREPARE_URL="$2/prepare"; SETUP_DISPATCH_URL="$2/dispatch"; SETUP_DISPATCH_OUTCOME_URL="$2/confirm"; SETUP_STATUS_URL="$2/status"; resolve_versioned_ledger_urls; PAYLOAD_RETRY_STATE="$3"; setup_claim_status',
          "ledger-redirect",
          script,
          trustedUrl,
          journal,
        ],
        {
          env: {
            ...process.env,
            HOME: root,
            CURL_HOME: root,
            REVIEW_ROUTER_SEED_LIBRARY_ONLY: "1",
            HTTP_PROXY: "",
            HTTPS_PROXY: "",
            ALL_PROXY: "",
            NO_PROXY: "127.0.0.1",
            http_proxy: "",
            https_proxy: "",
            all_proxy: "",
            no_proxy: "127.0.0.1",
          },
        },
      );
      let output = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => (output += chunk));
      child.stderr.on("data", (chunk) => (output += chunk));
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });

      expect(code).not.toBe(0);
      expect(trustedRequests).toBe(1);
      expect(trustedBodies).toEqual([JSON.stringify({ claimId: claimCanary })]);
      expect(crossOriginRequests).toBe(0);
      expect(output).not.toContain(claimCanary);
      expect(output).not.toContain("ambient-curlrc-transfer");
    },
  );
});

function listenOnLoopback(
  server: ReturnType<typeof createHttpServer>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
