/** Keep the deadline and byte limit in force through the complete response body. */
class HostedV4HttpError extends Error {}

export async function fetchHostedV4Json(input: {
  readonly fetchImpl: typeof fetch;
  readonly url: string;
  readonly init: RequestInit;
  readonly acceptedStatuses: readonly number[];
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly errorPrefix: string;
}): Promise<{ readonly status: number; readonly body: unknown }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new HostedV4HttpError(`${input.errorPrefix}_transport_ambiguous`));
    }, input.timeoutMs);
  });
  try {
    const response = await Promise.race([
      input.fetchImpl(input.url, {
        ...input.init,
        signal: controller.signal,
      }),
      deadline,
    ]);
    if (!input.acceptedStatuses.includes(response.status)) {
      void response.body?.cancel().catch(() => undefined);
      throw new HostedV4HttpError(`${input.errorPrefix}_denied_or_ambiguous`);
    }
    const reader = response.body?.getReader();
    if (!reader)
      throw new HostedV4HttpError(`${input.errorPrefix}_response_malformed`);
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      total += part.value.byteLength;
      if (total > input.maxBytes) {
        controller.abort();
        throw new HostedV4HttpError(`${input.errorPrefix}_response_too_large`);
      }
      chunks.push(part.value);
    }
    try {
      const json = new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks, total),
      );
      return { status: response.status, body: JSON.parse(json) as unknown };
    } catch {
      throw new HostedV4HttpError(`${input.errorPrefix}_response_malformed`);
    }
  } catch (error) {
    if (error instanceof HostedV4HttpError) throw error;
    // Provider/transport errors may contain credential-bearing request details.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`${input.errorPrefix}_transport_ambiguous`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
