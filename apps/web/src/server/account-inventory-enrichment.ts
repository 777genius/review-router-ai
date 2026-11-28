/** Read-only decoration of one accounts page. Local authorization remains
 * outside these waits; enrollment, quota refresh and lifecycle writes do not use it. */
export type AccountInventoryRead = <T>(
  read: (signal: AbortSignal) => Promise<T>,
) => Promise<T>;

export function createAccountInventoryEnrichment() {
  const controller = new AbortController();
  let deadlineAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired: Promise<never> | undefined;
  let expire: (() => void) | undefined;
  const unavailable = () =>
    new Error("account_inventory_enrichment_unavailable");
  function start() {
    if (deadlineAt !== undefined) return deadlineAt;
    deadlineAt = Date.now() + 3000;
    expired = new Promise<never>((_resolve, reject) => {
      expire = () => {
        controller.abort();
        reject(unavailable());
      };
      timer = setTimeout(expire, 3000);
      timer.unref?.();
    });
    // The shared deadline may outlive a fast read before another phase starts.
    // Observe it independently of individual races as well.
    void expired.catch(() => {});
    return deadlineAt;
  }
  const read: AccountInventoryRead = async (request) => {
    if (controller.signal.aborted) throw unavailable();
    if (Date.now() >= start()) expire!();
    if (controller.signal.aborted) throw unavailable();
    // Promise.race observes late failure. Its result never writes page state.
    // No worker starts another remote call once this page has expired.
    const owned = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw unavailable();
      return request(controller.signal);
    });
    return Promise.race([owned, expired!]);
  };
  return {
    read,
    signal: controller.signal,
    get deadlineAt() {
      return start();
    },
    async map<T, U>(
      rows: readonly T[],
      project: (row: T) => Promise<U>,
    ): Promise<U[]> {
      const result = new Array<U>(rows.length);
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, rows.length) }, async () => {
          while (next < rows.length) {
            const index = next++;
            result[index] = await project(rows[index]!);
          }
        }),
      );
      return result;
    },
    close() {
      if (timer) clearTimeout(timer);
      if (expire) expire();
      else controller.abort();
    },
  };
}
