import { z } from "zod";
import * as c from "@agent-teams/account-gateway/contracts";
import type { productionPersonalAccounts } from "./personal-account-composition";
import type { ConnectionProbeEvent } from "../features/account-gateway/connection-probe";

const schema = z.strictObject({
  context: z.string().min(1).max(256),
  workspaceId: c.reference,
  bindingId: c.reference,
  model: z.string().min(1).max(256),
  nonce: z.string().uuid(),
});
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
  "X-Accel-Buffering": "no",
};

export function createConnectionProbeHandler(
  load: () => Promise<Pick<
    NonNullable<Awaited<ReturnType<typeof productionPersonalAccounts>>>,
    "scope" | "probe"
  > | null>,
  publicOrigin?: string,
) {
  return async (request: Request): Promise<Response> => {
    // Next may normalize Request.url to localhost behind its Node adapter.
    // Host is the browser's actual destination; the deployment URL pins HTTPS
    // behind TLS termination. Never authorize an unrelated Origin/subdomain.
    const destination = new URL(publicOrigin ?? request.url);
    const host = request.headers.get("host");
    if (host) destination.host = host;
    if (
      request.headers.get("origin") !== destination.origin ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return new Response(null, { status: 403, headers });
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return new Response(null, { status: 415, headers });
    let raw: unknown;
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 400, headers });
    try {
      let size = 0,
        text = "";
      const decoder = new TextDecoder("utf-8", { fatal: true });
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 4096) return new Response(null, { status: 413, headers });
        text += decoder.decode(chunk.value, { stream: true });
      }
      raw = JSON.parse(text + decoder.decode());
    } catch {
      return new Response(null, { status: 400, headers });
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return new Response(null, { status: 400, headers });
    const cancel = new AbortController();
    const signal = AbortSignal.any([request.signal, cancel.signal]);
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: ConnectionProbeEvent) => {
          if (!signal.aborted)
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        };
        try {
          emit({ type: "progress", stage: "authorizing" });
          const service = await load();
          if (!service || service.scope !== parsed.data.context)
            emit({ type: "result", ok: false, code: "denied" });
          else
            await service.probe(parsed.data.workspaceId)(
              parsed.data,
              emit,
              signal,
            );
        } catch {
          emit({ type: "result", ok: false, code: "unavailable" });
        } finally {
          if (!signal.aborted) controller.close();
        }
      },
      cancel() {
        cancel.abort();
      },
    });
    return new Response(body, {
      headers: {
        ...headers,
        "Content-Type": "application/x-ndjson; charset=utf-8",
      },
    });
  };
}
