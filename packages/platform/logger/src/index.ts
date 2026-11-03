export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export function safeErrorSummary(
  error: unknown,
  options: {
    readonly fallback?: string;
    readonly maxLength?: number;
  } = {},
): string {
  const fallback = options.fallback ?? "unknown_error";
  const maxLength = options.maxLength ?? 500;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : fallback;
  const summary = redactSensitiveText(message).replaceAll(/\s+/g, " ").trim();

  return (summary || fallback).slice(0, Math.max(0, maxLength));
}

export function redactSensitiveText(value: string): string {
  return value
    .replaceAll(
      /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g,
      "<redacted>",
    )
    .replaceAll(
      /(postgres(?:ql)?:\/\/)([^:@\s/]+):([^@\s/]+)@/gi,
      "$1<redacted>@",
    )
    .replaceAll(
      /\bauthorization\s*[:=]\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
      "Authorization=<redacted>",
    )
    .replaceAll(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replaceAll(/\bghs_[A-Za-z0-9._-]{8,}/g, "<redacted>")
    .replaceAll(
      /\b(?:gh[opru]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|gl(?:pat|ft)-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{8,})\b/g,
      "<redacted>",
    )
    .replaceAll(
      /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
      "<redacted>",
    )
    .replaceAll(/([?&](?:access_)?token=)[^&\s]+/gi, "$1<redacted>")
    .replaceAll(
      /\b(token|secret|nonce|api[_-]?key|authorization|password|cookie)\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi,
      "$1=<redacted>",
    );
}

export class ConsoleLogger implements Logger {
  info(message: string, context?: Record<string, unknown>): void {
    console.info(message, context ?? {});
  }

  warn(message: string, context?: Record<string, unknown>): void {
    console.warn(message, context ?? {});
  }

  error(message: string, context?: Record<string, unknown>): void {
    console.error(message, context ?? {});
  }
}
