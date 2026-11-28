/** Keep repeated stop requests harmless while the host drains retained work. */
export function registerWorkerShutdown(
  onStop: (signal: NodeJS.Signals) => void,
) {
  const controller = new AbortController();
  const stop = (signal: NodeJS.Signals) => {
    if (controller.signal.aborted) return;
    controller.abort();
    onStop(signal);
  };
  const interrupt = () => stop("SIGINT");
  const terminate = () => stop("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  return {
    signal: controller.signal,
    dispose() {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    },
  };
}
