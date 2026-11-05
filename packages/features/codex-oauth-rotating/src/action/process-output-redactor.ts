/** Bounded line-framed output masking across arbitrary stdout/stderr chunks. */
import { StringDecoder } from "node:string_decoder";

const maxProcessLogRecordBytes = 64 * 1024;
const omittedProcessLogRecord =
  "[ReviewRouter omitted oversized process log record]";

export type ProcessOutputRedactor = {
  readonly write: (chunk: Buffer | string) => void;
  readonly finish: () => void;
};

export function createProcessOutputRedactor(
  stream: { readonly write: (value: string) => unknown } | undefined,
): ProcessOutputRedactor {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let pendingBytes = 0;
  let dropRecord = false;
  let finished = false;

  const appendPart = (part: string): void => {
    if (dropRecord || part.length === 0) return;
    const bytes = Buffer.byteLength(part, "utf8");
    if (pendingBytes + bytes > maxProcessLogRecordBytes) {
      pending = "";
      pendingBytes = 0;
      dropRecord = true;
      return;
    }
    pending += part;
    pendingBytes += bytes;
  };

  const flushRecord = (suffix: string): void => {
    stream?.write(
      (dropRecord
        ? omittedProcessLogRecord
        : sanitizeProcessLogRecord(pending)) + suffix,
    );
    pending = "";
    pendingBytes = 0;
    dropRecord = false;
  };

  const appendText = (text: string): void => {
    let cursor = 0;
    for (;;) {
      const newline = text.indexOf("\n", cursor);
      if (newline < 0) break;
      appendPart(text.slice(cursor, newline));
      flushRecord("\n");
      cursor = newline + 1;
    }
    appendPart(text.slice(cursor));
  };

  return {
    write: (chunk): void => {
      if (finished || !stream) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
      appendText(decoder.write(bytes));
    },
    finish: (): void => {
      if (finished) return;
      finished = true;
      if (!stream) return;
      appendText(decoder.end());
      if (pendingBytes > 0 || dropRecord) flushRecord("");
    },
  };
}

function sanitizeProcessLogRecord(output: string): string {
  return output
    .replace(/auth\.json["'\s:=]+[^\s"'\x60]+/gi, "auth.json: [redacted]")
    .replace(
      /\b(refresh_token|access_token|id_token)\b["'\s:=]+[A-Za-z0-9._~+/=-]+/gi,
      "$1: [redacted]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9._~+/=-]{120,}/g, "[redacted]");
}
