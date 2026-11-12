export type ReviewProgressComment = {
  readonly id: number;
  readonly body: string;
  readonly authorLogin: string;
};

/** Confirm a mutation only from the complete observed target-PR comment scan. */
export function confirmedReconciliation(
  observed: readonly ReviewProgressComment[],
  desiredBody: string,
  expectedCommentId?: number,
): ReviewProgressComment[] | null {
  if (
    !observed.some(
      ({ id, body }) =>
        body === desiredBody &&
        (expectedCommentId === undefined || id === expectedCommentId),
    )
  ) {
    return null;
  }
  return [...observed].sort((left, right) => {
    const desiredOrder =
      Number(right.body === desiredBody) - Number(left.body === desiredBody);
    return desiredOrder || left.id - right.id;
  });
}

/** Only complete pagination on a well-formed GitHub Link header. */
export function hasNextCommentPage(
  headers: Readonly<Record<string, string | number | undefined>> | undefined,
): boolean | "invalid" | undefined {
  const link = Object.entries(headers ?? {}).find(
    ([key]) => key.toLowerCase() === "link",
  )?.[1];
  if (link === undefined) return undefined;
  if (typeof link !== "string" || !link.trim()) return "invalid";
  const entries = link.split(/,\s*(?=<)/u);
  if (
    !entries.every((entry) =>
      /^\s*<[^>]+>\s*;\s*rel="(?:next|prev|first|last)"\s*$/iu.test(entry),
    )
  ) {
    return "invalid";
  }
  return entries.some((entry) => /;\s*rel="next"/iu.test(entry));
}
