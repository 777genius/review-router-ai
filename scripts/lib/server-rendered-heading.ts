// Checks text in server-rendered h1 elements; CSS and client-side visibility
// are outside this smoke contract. Attributes and inert content are not text.
export function hasH1Text(html: string, expected: string): boolean {
  const markup = html.replace(
    /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  let heading: string | undefined;
  for (const [token] of markup.matchAll(
    /<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/g,
  )) {
    if (/^<h1(?:\s|>)/i.test(token)) heading = "";
    else if (/^<\/h1\s*>$/i.test(token)) {
      if (heading?.replace(/\s+/g, " ").trim() === expected) return true;
      heading = undefined;
    } else if (heading !== undefined && !token.startsWith("<"))
      heading += token;
  }
  return false;
}
