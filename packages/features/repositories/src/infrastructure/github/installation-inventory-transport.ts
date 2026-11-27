/** Also covers the installation-token POST made inside Octokit's auth hook. */
export function createInventoryHttpTransport(
  fetchImpl: typeof fetch,
  timeoutMs: number,
): typeof fetch {
  return async (url, init) => {
    const controller = new AbortController();
    const signal = init?.signal
      ? AbortSignal.any([init.signal, controller.signal])
      : controller.signal;
    const timer = setTimeout(
      () => controller.abort(new Error("github_repository_request_deadline")),
      timeoutMs,
    );
    try {
      signal.throwIfAborted();
      const response = await fetchImpl(url, { ...init, signal });
      if (signal.aborted) {
        await response.body?.cancel();
        signal.throwIfAborted();
      }
      // Read before handing the response to Octokit, which can otherwise hide
      // an interrupted text body as an empty successful response.
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
