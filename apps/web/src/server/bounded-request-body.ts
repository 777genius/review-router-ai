export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request_body_too_large");
    this.name = "RequestBodyTooLargeError";
  }
}

/** Bound bytes while reading; Content-Length is only an early rejection hint. */
export async function readBoundedRequestText(
  request: Request,
  maximumBytes: number,
): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1)
    throw new Error("request_body_limit_invalid");
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength &&
    /^\d+$/u.test(declaredLength) &&
    Number(declaredLength) > maximumBytes
  ) {
    void request.body?.cancel().catch(() => undefined);
    throw new RequestBodyTooLargeError();
  }
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        // Cancellation itself may be uncooperative; rejection must remain bounded.
        void reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, bytes),
    );
  } finally {
    reader.releaseLock();
  }
}

export async function readBoundedRequestJson(
  request: Request,
  maximumBytes: number,
): Promise<unknown> {
  return JSON.parse(await readBoundedRequestText(request, maximumBytes));
}
