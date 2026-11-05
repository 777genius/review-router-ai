/** Retry and response-disposal policy for Action HTTP transport. */
type FetchLike = typeof fetch;
export const networkRetryMaxAttempts = 3;
const networkRetryBaseDelayMs = 750;

export async function fetchWithRetry<T = Response>(input: {
  readonly fetchImpl: FetchLike;
  readonly label: string;
  readonly url: string;
  readonly init?: RequestInit;
  readonly timeoutMs: number;
  readonly maxAttempts?: number;
  readonly consume?: ((response: Response) => Promise<T>) | undefined;
}): Promise<T> {
  const maxAttempts = input.maxAttempts ?? networkRetryMaxAttempts;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const externalSignal = input.init?.signal;
    if (externalSignal?.aborted) {
      throw new Error(
        `network_request_aborted:${safeNetworkLabel(input.label)}`,
      );
    }
    const abortFromExternalSignal = (): void => controller.abort();
    externalSignal?.addEventListener("abort", abortFromExternalSignal, {
      once: true,
    });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, input.timeoutMs);
    let cleanedUp = false;
    const cleanup = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternalSignal);
    };

    // Retry only transport failures and explicit retryable status codes.
    // The server may have committed a write when response consumption fails:
    // replaying POST/PATCH here could duplicate a completed operation.
    let response: Response;
    try {
      response = await input.fetchImpl(input.url, {
        ...input.init,
        signal: controller.signal,
      });
    } catch (error) {
      cleanup();
      lastError = error;
      if (externalSignal?.aborted) {
        throw new Error(
          `network_request_aborted:${safeNetworkLabel(input.label)}`,
          { cause: error },
        );
      }
      if (attempt < maxAttempts) {
        await sleepBeforeRetry(
          networkRetryDelayMs(attempt),
          externalSignal,
          input.label,
        );
        continue;
      }
      const code = timedOut
        ? "network_request_timeout"
        : "network_request_failed";
      throw new Error(`${code}:${safeNetworkLabel(input.label)}`, {
        cause: error,
      });
    }

    if (shouldRetryHttpStatus(response.status) && attempt < maxAttempts) {
      await discardResponseBody(response);
      cleanup();
      await sleepBeforeRetry(
        networkRetryDelayMs(attempt),
        externalSignal,
        input.label,
      );
      continue;
    }

    try {
      return input.consume ? await input.consume(response) : (response as T);
    } catch (error) {
      const code = externalSignal?.aborted
        ? "network_request_aborted"
        : timedOut
          ? "network_request_timeout"
          : "network_request_failed";
      throw new Error(`${code}:${safeNetworkLabel(input.label)}`, {
        cause: error,
      });
    } finally {
      cleanup();
    }
  }

  throw new Error(`network_request_failed:${safeNetworkLabel(input.label)}`, {
    cause: lastError,
  });
}

/**
 * Cancels retry backoff immediately when the caller aborts, rather than
 * delaying cancellation until the next network attempt.
 */
function sleepBeforeRetry(
  ms: number,
  signal: AbortSignal | null | undefined,
  label: string,
): Promise<void> {
  if (!signal) return sleep(ms);
  const aborted = (): Error =>
    new Error(`network_request_aborted:${safeNetworkLabel(label)}`);
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(aborted());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function shouldRetryHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

export function networkRetryDelayMs(attempt: number): number {
  return networkRetryBaseDelayMs * 2 ** Math.max(0, attempt - 1);
}

function safeNetworkLabel(label: string): string {
  return /^[a-z0-9_:-]{1,80}$/i.test(label) ? label : "unknown";
}

export async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.arrayBuffer();
  } catch {
    // Best effort only. The retry path should not fail because body cleanup did.
  }
}

export async function consumeResponseBody(
  response: Response,
): Promise<Response> {
  await discardResponseBody(response);
  return response;
}

export async function consumeJsonResponse(response: Response): Promise<{
  readonly response: Response;
  readonly body: unknown;
}> {
  if (!response.ok) {
    await discardResponseBody(response);
    return { response, body: undefined };
  }
  return { response, body: await response.json() };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
