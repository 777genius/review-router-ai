/** Fetch only fixture-owned Next scripts, consuming their complete response bodies. */
export async function warmDashboardScripts(
  appUrl: string,
  html: string,
  signal: AbortSignal,
): Promise<void> {
  const origin = new URL(appUrl);
  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
  )
    throw new Error("accounts_reference_e2e_warmup_requires_loopback");
  const scripts = new Set<string>();
  for (const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gu)) {
    const source = match[1]!;
    if (!source.startsWith("/_next/static/")) continue;
    const url = new URL(source.replaceAll("&amp;", "&"), origin);
    if (
      url.origin !== origin.origin ||
      !url.pathname.startsWith("/_next/static/")
    )
      throw new Error("accounts_reference_e2e_warmup_invalid_script");
    scripts.add(url.href);
  }
  if (!scripts.size)
    throw new Error("accounts_reference_e2e_warmup_missing_scripts");
  for (const url of scripts) {
    const response = await fetch(url, {
      redirect: "error",
      credentials: "omit",
      signal,
    });
    if (!response.ok)
      throw new Error(
        `accounts_reference_e2e_script_warmup_status_${response.status}`,
      );
    await response.arrayBuffer();
  }
}
