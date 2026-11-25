export function readHostedReviewMaxChangedLines(
  value: string | undefined,
): number {
  return readPositiveInteger(
    value,
    250_000,
    "hosted_review_max_changed_lines_invalid",
  );
}

export function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  errorCode: string,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(errorCode);
  }
  return parsed;
}
