import fastify from "fastify";
import { registerApiGracefulShutdown } from "../api-graceful-shutdown.js";

const app = fastify({ logger: false });
let closeCalls = 0;
let release!: () => void;
const gate = new Promise<void>((resolve) => {
  release = resolve;
});
const send = (message: Record<string, unknown>) => process.send?.(message);
process.on("message", (message) => {
  if (message === "release") release();
});
app.addHook("preClose", async () => {
  send({ type: "pre-close", closeCalls });
  await gate;
  send({ type: "drained", closeCalls });
});
app.addHook("onClose", async () => {
  send({ type: "closed", closeCalls });
  // IPC belongs to this fixture only; let the real child exit naturally after
  // shutdown has settled rather than calling process.exit() in the helper.
  setImmediate(() => process.disconnect?.());
});
registerApiGracefulShutdown({
  async close() {
    closeCalls++;
    send({ type: "close-called", closeCalls });
    await app.close();
    if (process.argv[2] === "fail")
      throw new Error("fixture-secret-must-not-appear-in-shutdown-log");
  },
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => send({ type: "signal", signal, closeCalls }));
await app.listen({ host: "127.0.0.1", port: 0 });
send({ type: "ready" });
