import { z } from "zod";
import {
  connectionProbeStages,
  type ConnectionProbeEvent,
  type ConnectionProbeRequest,
} from "../../src/features/account-gateway/connection-probe";

const eventSchema = z.union([
  z.strictObject({
    type: z.literal("progress"),
    stage: z.enum(connectionProbeStages),
  }),
  z.union([
    z.strictObject({
      type: z.literal("result"),
      ok: z.literal(true),
      elapsedMs: z.number().nonnegative(),
      model: z.string().max(256),
    }),
    z.strictObject({
      type: z.literal("result"),
      ok: z.literal(false),
      code: z.enum([
        "denied",
        "unavailable",
        "invalid_response",
        "timeout",
        "cancelled",
        "busy",
        "rate_limited",
        "cleanup_pending",
      ]),
    }),
  ]),
]);

/** One user click, one POST. No retry after an uncertain provider effect. */
export async function testGatewayConnection(
  request: ConnectionProbeRequest,
  onEvent: (event: ConnectionProbeEvent) => void,
  signal: AbortSignal,
) {
  const timeout = AbortSignal.timeout(115000);
  const combined = AbortSignal.any([signal, timeout]);
  const response = await fetch("/api/dashboard/accounts/test", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal: combined,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (
    !response.ok ||
    !response.body ||
    !response.headers.get("content-type")?.startsWith("application/x-ndjson")
  )
    throw new Error("probe_unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "",
    bytes = 0,
    terminal = false;
  function line(value: string) {
    if (!value.trim()) return;
    if (terminal) throw new Error("probe_invalid_response");
    const event = eventSchema.parse(JSON.parse(value));
    terminal = event.type === "result";
    onEvent(event);
  }
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 16384) throw new Error("probe_invalid_response");
      pending += decoder.decode(chunk.value, { stream: true });
      let end;
      while ((end = pending.indexOf("\n")) !== -1) {
        line(pending.slice(0, end));
        pending = pending.slice(end + 1);
      }
    }
    line(pending + decoder.decode());
    if (!terminal) throw new Error("probe_incomplete");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
