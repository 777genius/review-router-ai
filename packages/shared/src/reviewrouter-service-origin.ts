/** Existing callers validate/normalize URLs before this comparison. Exact custom
 * origins retain their prior semantics. Only these two owned production origins
 * are aliases; never infer trust from redirects, DNS, suffixes or URL rewriting.
 */
export function reviewRouterApiUrlsMatch(
  actual: string,
  expected: string,
): boolean {
  if (actual === expected) return true;
  const ownedOrigins = [
    "https://api.reviewrouter.org",
    "https://api.reviewrouter.site",
  ];
  return ownedOrigins.includes(expected) && ownedOrigins.includes(actual);
}
