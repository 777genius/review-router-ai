import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));
import {
  exchangeContextProbeHttps,
  isPublicContextAddress,
  probeContextTools,
} from "./context-tools-probe";

type ResponseFixture = {
  status?: number;
  type?: string;
  body?: string;
  open?: boolean;
  session?: string;
  peer?: string;
  chunks?: string[];
};
const seen: {
  method: string;
  headers: Record<string, string>;
  body: string;
  pinned: string;
}[] = [];
let responseFor: (method: string, body: string) => ResponseFixture;
beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  seen.length = 0;
  mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  responseFor = (_method, body) => {
    const rpc = JSON.parse(body) as { id?: number; method: string };
    if (rpc.method === "initialize")
      return {
        session: "session-123",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "fixture", version: "1" },
          },
        }),
      };
    if (rpc.method === "notifications/initialized") return { status: 202 };
    return {
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: rpc.id,
        result: {
          tools: [
            {
              name: "search",
              description: "Plain description",
              inputSchema: { type: "object" },
            },
          ],
        },
      }),
    };
  };
  mocks.request.mockImplementation(
    (
      _url: URL,
      options: {
        method: string;
        headers: Record<string, string>;
        lookup: (
          host: string,
          options: object,
          cb: (error: unknown, address: string, family: number) => void,
        ) => void;
      },
      callback: (response: PassThrough) => void,
    ) => {
      const req = new EventEmitter() as EventEmitter & {
        end: (body?: string) => void;
        destroy: () => void;
      };
      req.destroy = () => {
        req.emit("close");
      };
      req.end = (body = "") => {
        let pinned = "";
        options.lookup("fixture", {}, (_error, address) => {
          pinned = address;
        });
        seen.push({
          method: options.method,
          headers: options.headers,
          body,
          pinned,
        });
        queueMicrotask(() => {
          const fixture =
            options.method === "DELETE"
              ? { status: 204 }
              : responseFor(options.method, body);
          const socket = Object.assign(new EventEmitter(), {
            remoteAddress: fixture.peer ?? pinned,
          });
          req.emit("socket", socket);
          socket.emit("secureConnect");
          const response = Object.assign(new PassThrough(), {
            statusCode: fixture.status ?? 200,
            headers: {
              "content-type": fixture.type ?? "application/json",
              ...(fixture.session ? { "mcp-session-id": fixture.session } : {}),
            },
          });
          callback(response);
          for (const chunk of fixture.chunks ??
            (fixture.body ? [fixture.body] : []))
            response.write(chunk);
          if (!fixture.open) response.end();
        });
      };
      return req;
    },
  );
});
const input = { url: "https://mcp.example.com/mcp", headers: {}, redact: [] };
const exchangeInput = () => ({
  url: input.url,
  method: "POST" as const,
  headers: {},
  body: "{}",
  responseId: 1,
  deadline: Date.now() + 1000,
});

describe("native HTTPS MCP discovery boundary", () => {
  it("initializes, notifies, lists only and terminates the negotiated session without tool/model invocation", async () => {
    expect(await probeContextTools(input)).toEqual([
      { name: "search", description: "Plain description" },
    ]);
    expect(
      seen.map((request) =>
        request.method === "DELETE"
          ? "DELETE"
          : JSON.parse(request.body).method,
      ),
    ).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "DELETE",
    ]);
    expect(seen.every((request) => request.pinned === "93.184.216.34")).toBe(
      true,
    );
    expect(seen[0]?.headers["MCP-Protocol-Version"]).toBeUndefined();
    for (const request of seen.slice(1))
      expect(request.headers).toMatchObject({
        "Mcp-Session-Id": "session-123",
        "MCP-Protocol-Version": "2025-06-18",
        Accept: "application/json, text/event-stream",
      });
  });
  it.each(["\n", "\r\n", "\r"])(
    "accepts an SSE reply with %j framing before the connection closes and ignores notifications",
    async (newline) => {
      responseFor = () => ({
        type: "text/event-stream",
        open: true,
        chunks: [
          `: keepalive${newline}${newline}data: {"jsonrpc":"2.0","method":"notifications/message","params":{"data":"untrusted"}}${newline}${newline}`,
          `data: {"jsonrpc":"2.0","id":1,"result":{"accepted":true}}${newline}`,
          newline,
        ],
      });
      expect(await exchangeContextProbeHttps(exchangeInput())).toMatchObject({
        message: { id: 1, result: { accepted: true } },
      });
    },
  );
  it.each([
    { addresses: [{ address: "127.0.0.1", family: 4 }] },
    {
      addresses: [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
    },
    { addresses: [{ address: "::1", family: 6 }] },
    { addresses: [{ address: "::ffff:127.0.0.1", family: 6 }] },
  ])(
    "refuses private and mixed DNS answers before creating a request",
    async ({ addresses }) => {
      mocks.lookup.mockResolvedValue(addresses);
      await expect(
        exchangeContextProbeHttps(exchangeInput()),
      ).rejects.toMatchObject({ code: "context_mcp_address_forbidden" });
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );
  it("rejects redirects once and rejects a connected peer that differs from pinned DNS", async () => {
    responseFor = () => ({ status: 302, body: "secret remote error" });
    await expect(
      exchangeContextProbeHttps(exchangeInput()),
    ).rejects.toMatchObject({ code: "context_mcp_unavailable" });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    responseFor = () => ({ peer: "10.0.0.1", body: "{}" });
    await expect(
      exchangeContextProbeHttps(exchangeInput()),
    ).rejects.toMatchObject({ code: "context_mcp_address_forbidden" });
  });
  it("bounds streamed bytes, hanging streams and DNS without leaking response text", async () => {
    responseFor = () => ({ body: "private".repeat(150000) });
    await expect(
      exchangeContextProbeHttps(exchangeInput()),
    ).rejects.toMatchObject({ message: "context_mcp_discovery_limit" });
    responseFor = () => ({ type: "text/event-stream", open: true });
    const timeout = exchangeContextProbeHttps({
      ...exchangeInput(),
      deadline: Date.now() + 15,
    });
    await expect(timeout).rejects.toMatchObject({
      code: "context_mcp_timeout",
    });
    mocks.lookup.mockReturnValue(new Promise(() => {}));
    await expect(
      exchangeContextProbeHttps({
        ...exchangeInput(),
        deadline: Date.now() + 15,
      }),
    ).rejects.toMatchObject({ code: "context_mcp_timeout" });
  });
  it("does not leave a deadline behind when HTTPS request construction throws", async () => {
    vi.useFakeTimers();
    mocks.request.mockImplementation(() => {
      throw new TypeError("invalid header value");
    });
    try {
      await expect(exchangeContextProbeHttps(exchangeInput())).rejects.toThrow(
        "invalid header value",
      );
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("redacts reflected credentials and refuses reflected tool identifiers", async () => {
    const original = responseFor;
    responseFor = (method, body) =>
      JSON.parse(body).method === "tools/list"
        ? {
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 2,
              result: {
                tools: [
                  {
                    name: "search",
                    description:
                      "token private-token Bearer private-token private\u0001-token",
                    inputSchema: { type: "object" },
                  },
                ],
              },
            }),
          }
        : original(method, body);
    expect(
      await probeContextTools({
        ...input,
        headers: { Authorization: "Bearer private-token" },
        redact: ["private-token", "Bearer private-token"],
      }),
    ).toEqual([
      { name: "search", description: "token [redacted] [redacted] [redacted]" },
    ]);
    responseFor = (method, body) =>
      JSON.parse(body).method === "tools/list"
        ? {
            body: '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"private-token","inputSchema":{"type":"object"}}]}}',
          }
        : original(method, body);
    await expect(
      probeContextTools({ ...input, redact: ["private-token"] }),
    ).rejects.toMatchObject({ code: "context_mcp_protocol_invalid" });
  });
  it("never returns partial discovery for pagination and cleans up after a protocol failure", async () => {
    const original = responseFor;
    responseFor = (method, body) =>
      JSON.parse(body).method === "tools/list"
        ? {
            body: '{"jsonrpc":"2.0","id":2,"result":{"tools":[],"nextCursor":"more"}}',
          }
        : original(method, body);
    await expect(probeContextTools(input)).rejects.toMatchObject({
      code: "context_mcp_discovery_limit",
    });
    expect(seen.at(-1)?.method).toBe("DELETE");
  });
  it.each([
    "0.0.0.0",
    "169.254.169.254",
    "192.168.1.1",
    "100.64.0.1",
    "2001:db8::1",
    "2001::1",
    "2002::1",
    "fc00::1",
    "fe80::1",
    "::ffff:808:808",
  ])("denies non-public address %s", (address) => {
    expect(isPublicContextAddress(address)).toBe(false);
  });
});
