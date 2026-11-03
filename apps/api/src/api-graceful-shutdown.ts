/** Keep signal handling installed while Fastify drains retained capabilities.
 * Closing the app is not proof that every native cleanup operation applied. */
export function registerApiGracefulShutdown(app: {
  close(): Promise<unknown>;
}): void {
  let closing: Promise<void> | undefined;
  const shutdown = () => {
    closing ??= (async () => {
      try {
        await app.close();
      } catch {
        process.exitCode = 1;
        console.error(
          "ReviewRouter API shutdown failed; cleanup is unconfirmed.",
        );
      }
    })();
  };
  // Do not use once(): a second signal must not restore Node's immediate exit
  // while the first close is still awaiting retained Gateway cleanup.
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
