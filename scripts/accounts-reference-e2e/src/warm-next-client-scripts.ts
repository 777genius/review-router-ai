/** Drain the real Next script responses during the existing bounded fixture boot. */
export async function warmNextClientScripts(
  html: string,
  appUrl: string,
  signal: AbortSignal,
  warmed: Set<string>,
): Promise<void> {
  const origin = new URL(appUrl).origin;
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gu)];
  if (scripts.length === 0)
    throw new Error("accounts_reference_e2e_client_scripts_missing");
  for (const match of scripts) {
    const source = match[1];
    if (!source)
      throw new Error("accounts_reference_e2e_client_script_invalid");
    const url = new URL(source.replaceAll("&amp;", "&"), appUrl);
    // The fixture never warms external resources or credential-bearing routes.
    if (url.origin !== origin || !url.pathname.startsWith("/_next/static/"))
      throw new Error("accounts_reference_e2e_client_script_outside_fixture");
    if (warmed.has(url.href)) continue;
    const response = await fetch(url, { redirect: "error", signal });
    if (!response.ok)
      throw new Error("accounts_reference_e2e_client_script_unavailable");
    await response.arrayBuffer();
    warmed.add(url.href);
  }
}
