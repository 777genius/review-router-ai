import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import type { TLSSocket } from "node:tls";
import { z } from "zod";

export type ContextProbeTool = { name: string; description?: string };
export type ContextProbeErrorCode =
  | "context_mcp_timeout"
  | "context_mcp_address_forbidden"
  | "context_mcp_auth_required"
  | "context_mcp_protocol_invalid"
  | "context_mcp_discovery_limit"
  | "context_mcp_unavailable";
export class ContextProbeError extends Error {
  constructor(readonly code: ContextProbeErrorCode) {
    super(code);
  }
}
function fail(code: ContextProbeErrorCode): never {
  throw new ContextProbeError(code);
}
const maxBytes = 1_048_576;
const timeoutMs = 30_000;
const versions = ["2025-11-25", "2025-06-18", "2025-03-26"];

/** Conservative public unicast policy shared with the Action's HTTPS MCP boundary. */
export function isPublicContextAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number) as [
      number,
      number,
      number,
    ];
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 &&
        (b === 0 || b === 168 || b === 2 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) !== 6 || address.includes(".") || address.includes("%"))
    return false;
  const parts = address.split("::");
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const words = [
    ...head,
    ...Array(8 - head.length - tail.length).fill("0"),
    ...tail,
  ].map((word) => parseInt(word, 16));
  const first = words[0]!,
    second = words[1]!;
  return (
    first >= 0x2000 &&
    first <= 0x3fff &&
    first !== 0x2002 &&
    first !== 0x3fff &&
    !(first === 0x2001 && (second < 0x0200 || second === 0x0db8))
  );
}
const normalizeAddress = (value: string): string => {
  if (isIP(value) === 4) return value;
  try {
    return new URL(`http://[${value}]/`).hostname;
  } catch {
    return "";
  }
};
export type ContextProbeExchange = (input: {
  url: string;
  method: "POST" | "DELETE";
  headers: Record<string, string>;
  body?: string;
  responseId?: number;
  deadline: number;
}) => Promise<{ status: number; sessionId?: string; message?: unknown }>;

function rpcResponse(
  value: unknown,
  id: number,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const message = value as Record<string, unknown>;
  if (message.jsonrpc !== "2.0" || message.id !== id) return undefined;
  if ("error" in message || !("result" in message))
    fail("context_mcp_protocol_invalid");
  return message;
}

/** Native HTTPS pins a freshly validated DNS answer, certificate hostname and connected peer. Never follows redirects. */
export const exchangeContextProbeHttps: ContextProbeExchange = async (
  input,
) => {
  const url = new URL(input.url);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    fail("context_mcp_address_forbidden");
  const remaining = () => Math.max(1, input.deadline - Date.now());
  let dnsTimer: NodeJS.Timeout | undefined;
  let addresses: { address: string; family: number }[];
  try {
    if (Date.now() >= input.deadline) fail("context_mcp_timeout");
    addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await Promise.race([
          lookup(hostname, { all: true, verbatim: true }),
          new Promise<never>((_resolve, reject) => {
            dnsTimer = setTimeout(
              () => reject(new ContextProbeError("context_mcp_timeout")),
              remaining(),
            );
          }),
        ]);
  } catch (error) {
    if (error instanceof ContextProbeError) throw error;
    return fail("context_mcp_unavailable");
  } finally {
    if (dnsTimer) clearTimeout(dnsTimer);
  }
  if (
    !addresses.length ||
    addresses.some((item) => !isPublicContextAddress(item.address))
  )
    fail("context_mcp_address_forbidden");
  if (Date.now() >= input.deadline) fail("context_mcp_timeout");
  const address = (addresses.find((item) => item.family === 4) ??
    addresses[0])!;
  return new Promise((resolve, reject) => {
    let settled = false;
    const lifecycle: { timer?: NodeJS.Timeout } = {};
    const finish = (
      error?: ContextProbeError,
      result?: Awaited<ReturnType<ContextProbeExchange>>,
    ) => {
      if (settled) return;
      settled = true;
      if (lifecycle.timer) clearTimeout(lifecycle.timer);
      if (error) reject(error);
      else resolve(result!);
    };
    const req = request(
      url,
      {
        method: input.method,
        headers: input.headers,
        agent: false,
        family: address.family,
        servername: isIP(hostname) ? undefined : hostname,
        rejectUnauthorized: true,
        lookup: (_hostname, _options, callback) =>
          callback(null, address.address, address.family),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const abort = (code: ContextProbeErrorCode) => {
          finish(new ContextProbeError(code));
          res.destroy();
          req.destroy();
        };
        if (status === 401 || status === 403) {
          abort("context_mcp_auth_required");
          return;
        }
        // Redirect targets and error bodies are deliberately ignored, including during session cleanup.
        if (status < 200 || status >= 300) {
          if (input.method === "DELETE" && (status === 404 || status === 405)) {
            finish(undefined, { status });
            res.destroy();
            return;
          }
          abort("context_mcp_unavailable");
          return;
        }
        const rawSessionId = res.headers["mcp-session-id"];
        if (
          rawSessionId !== undefined &&
          (typeof rawSessionId !== "string" ||
            !/^[\x21-\x7e]{1,1024}$/.test(rawSessionId))
        ) {
          abort("context_mcp_protocol_invalid");
          return;
        }
        const session =
          typeof rawSessionId === "string" ? { sessionId: rawSessionId } : {};
        if (input.responseId === undefined) {
          finish(undefined, { status, ...session });
          res.destroy();
          return;
        }
        const type = res.headers["content-type"]?.split(";")[0]?.trim();
        if (type !== "application/json" && type !== "text/event-stream") {
          abort("context_mcp_protocol_invalid");
          return;
        }
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let text = "",
          size = 0,
          lastWasCr = false;
        const normalizeSse = (chunk: string) => {
          let normalized = "";
          for (const char of chunk) {
            if (char === "\n" && lastWasCr) {
              lastWasCr = false;
              continue;
            }
            normalized += char === "\r" ? "\n" : char;
            lastWasCr = char === "\r";
          }
          return normalized;
        };
        const accept = (value: unknown) => {
          const message = rpcResponse(value, input.responseId!);
          if (!message) return false;
          finish(undefined, { status, ...session, message });
          res.destroy();
          return true;
        };
        res.on("data", (chunk: Buffer) => {
          if (settled) return;
          size += chunk.length;
          if (size > maxBytes) {
            abort("context_mcp_discovery_limit");
            return;
          }
          try {
            const decoded = decoder.decode(chunk, { stream: true });
            text +=
              type === "text/event-stream" ? normalizeSse(decoded) : decoded;
            if (type === "text/event-stream") {
              // SSE frames can straddle chunks; a matching response ends the stream even if the server leaves it open.
              for (;;) {
                const end = text.indexOf("\n\n");
                if (end < 0) break;
                const frame = text.slice(0, end);
                text = text.slice(end + 2);
                const data = frame
                  .split("\n")
                  .filter((line) => line.startsWith("data:"))
                  .map((line) => line.slice(5).replace(/^ /, ""))
                  .join("\n");
                if (data && accept(JSON.parse(data))) return;
              }
            }
          } catch (error) {
            abort(
              error instanceof ContextProbeError
                ? error.code
                : "context_mcp_protocol_invalid",
            );
          }
        });
        res.on("end", () => {
          if (settled) return;
          try {
            text += decoder.decode();
            if (type === "application/json" && accept(JSON.parse(text))) return;
          } catch {
            /* Never include remote payloads in errors. */
          }
          abort("context_mcp_protocol_invalid");
        });
        res.on("error", () => {
          if (!settled) abort("context_mcp_unavailable");
        });
        res.on("close", () => {
          if (!settled) abort("context_mcp_unavailable");
        });
      },
    );
    lifecycle.timer = setTimeout(() => {
      finish(new ContextProbeError("context_mcp_timeout"));
      req.destroy();
    }, remaining());
    lifecycle.timer.unref();
    req.on("socket", (socket) => {
      (socket as TLSSocket).once("secureConnect", () => {
        const actual = socket.remoteAddress?.replace(/^::ffff:/, "");
        if (
          !actual ||
          normalizeAddress(actual) !== normalizeAddress(address.address)
        ) {
          finish(new ContextProbeError("context_mcp_address_forbidden"));
          req.destroy();
        }
      });
    });
    req.on("error", () =>
      finish(new ContextProbeError("context_mcp_unavailable")),
    );
    req.end(input.body);
  });
};

const toolSchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/),
  description: z.string().max(8192).optional(),
  inputSchema: z.object({ type: z.literal("object") }).passthrough(),
  execution: z
    .object({
      taskSupport: z.enum(["required", "optional", "forbidden"]).optional(),
    })
    .optional(),
});
/** Discovery only. There is no tools/call, model transport, OAuth, redirect or persistence path. */
export async function probeContextTools(
  input: {
    url: string;
    headers: Record<string, string>;
    redact: readonly string[];
  },
  exchange: ContextProbeExchange = exchangeContextProbeHttps,
): Promise<ContextProbeTool[]> {
  const deadline = Date.now() + timeoutMs;
  let sessionId: string | undefined, protocolVersion: string | undefined;
  const headers = () => ({
    ...input.headers,
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    ...(protocolVersion ? { "MCP-Protocol-Version": protocolVersion } : {}),
  });
  const send = async (method: string, id?: number, params?: unknown) => {
    const result = await exchange({
      url: input.url,
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        ...(id === undefined ? {} : { id }),
        method,
        ...(params === undefined ? {} : { params }),
      }),
      ...(id === undefined ? {} : { responseId: id }),
      deadline,
    });
    // Retain initialization session early enough to clean up failed negotiation.
    if (method === "initialize") sessionId = result.sessionId;
    if (id === undefined) {
      if (result.status !== 202) fail("context_mcp_protocol_invalid");
      return undefined;
    }
    const message = rpcResponse(result.message, id);
    if (!message) return fail("context_mcp_protocol_invalid");
    return message.result;
  };
  try {
    const initialized = z
      .object({
        protocolVersion: z.string(),
        capabilities: z.object({
          tools: z.object({}).passthrough().optional(),
        }),
        serverInfo: z.object({ name: z.string(), version: z.string() }),
      })
      .safeParse(
        await send("initialize", 1, {
          protocolVersion: versions[0],
          capabilities: {},
          clientInfo: { name: "reviewrouter-connection-test", version: "1" },
        }),
      );
    if (
      !initialized.success ||
      !versions.includes(initialized.data.protocolVersion)
    )
      fail("context_mcp_protocol_invalid");
    protocolVersion = initialized.data.protocolVersion;
    await send("notifications/initialized");
    if (!initialized.data.capabilities.tools) return [];
    const discovered = z
      .object({
        tools: z.array(toolSchema).max(100),
        nextCursor: z.string().optional(),
      })
      .safeParse(await send("tools/list", 2, {}));
    if (!discovered.success) fail("context_mcp_protocol_invalid");
    // Action runtime currently requires a single bounded discovery page; never advertise tools it cannot consume.
    if (
      discovered.data.nextCursor ||
      discovered.data.tools.some(
        (tool) =>
          tool.execution?.taskSupport === "required" ||
          Buffer.byteLength(JSON.stringify(tool.inputSchema)) > 65536,
      )
    )
      fail("context_mcp_discovery_limit");
    if (
      new Set(discovered.data.tools.map((tool) => tool.name)).size !==
      discovered.data.tools.length
    )
      fail("context_mcp_protocol_invalid");
    const stripControls = (value: string) =>
      [...value]
        .filter((character) => {
          const code = character.charCodeAt(0);
          return (
            code === 9 ||
            code === 10 ||
            code === 13 ||
            (code >= 32 && code !== 127)
          );
        })
        .join("");
    const redact = (value: string) =>
      input.redact
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)
        .reduce(
          (text, secret) => text.split(secret).join("[redacted]"),
          stripControls(value),
        );
    return discovered.data.tools.map((tool) => {
      // Reflected credentials must not become selectable tool identifiers either.
      if (input.redact.some((secret) => secret && tool.name.includes(secret)))
        fail("context_mcp_protocol_invalid");
      return {
        name: tool.name,
        ...(tool.description === undefined
          ? {}
          : { description: redact(tool.description) }),
      };
    });
  } catch (error) {
    if (error instanceof ContextProbeError) throw error;
    return fail("context_mcp_unavailable");
  } finally {
    if (sessionId) {
      // Termination gets its own short bounded budget after an exhausted discovery deadline. No retries.
      await exchange({
        url: input.url,
        method: "DELETE",
        headers: headers(),
        deadline: Date.now() + 2000,
      }).catch(() => undefined);
    }
  }
}
