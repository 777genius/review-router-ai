/** Octokit's auth token requests and response reads share this actual IO bound. */
export function createProgressHttpTransport(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 15_000,
): typeof fetch {
  return async (url, init) => {
    const controller = new AbortController();
    const signal = init?.signal
      ? AbortSignal.any([init.signal, controller.signal])
      : controller.signal;
    const timer = setTimeout(
      () => controller.abort(new Error("github_progress_request_deadline")),
      timeoutMs,
    );
    try {
      signal.throwIfAborted();
      const response = await fetchImpl(url, { ...init, signal });
      if (signal.aborted) {
        await response.body?.cancel();
        signal.throwIfAborted();
      }
      // Octokit swallows some response.text() errors. Read here so an aborted
      // JSON body cannot become an apparently successful empty observation.
      const body = await response.arrayBuffer();
      signal.throwIfAborted();
      return new Response(
        [204, 205, 304].includes(response.status) ? null : body,
        {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        },
      );
    } finally {
      clearTimeout(timer);
    }
  };
}
