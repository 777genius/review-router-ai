/** Bound observation, not the lifetime of an operation that ignores abort. */
export async function withReviewRequestedIoTimeout<T>(
  timeoutMs: number,
  work: (signal: AbortSignal) => Promise<T>,
  onSoftTimeout?: () => void,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          if (onSoftTimeout) onSoftTimeout();
          else controller.abort();
          reject(new Error("review_requested_preparation_timeout"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
