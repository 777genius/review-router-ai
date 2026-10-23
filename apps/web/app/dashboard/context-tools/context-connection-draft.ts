/** The JSON text is the editable authority; guided controls only patch its fields. */
export type ConnectionDraft = Record<string, unknown>;
export type DraftAuth =
  | { mode: "none" }
  | { mode: "bearer"; secretName: string }
  | { mode: "advanced" };

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function parseConnectionDraft(text: string): ConnectionDraft | null {
  try {
    const value: unknown = JSON.parse(text);
    return record(value) ? value : null;
  } catch {
    return null;
  }
}
export function draftSecretNames(draft: ConnectionDraft | null): string[] {
  if (!record(draft?.credentials)) return [];
  return Object.entries(draft.credentials)
    .filter(
      ([name, binding]) =>
        /^[A-Z][A-Z0-9_]{0,63}$/.test(name) &&
        record(binding) &&
        binding.source === "dashboard-secret",
    )
    .map(([name]) => name)
    .slice(0, 20);
}
export function draftAuth(draft: ConnectionDraft | null): DraftAuth {
  if (!record(draft?.headers) || !record(draft?.credentials))
    return { mode: "advanced" };
  const headers = Object.entries(draft.headers);
  const credentials = Object.entries(draft.credentials);
  if (!headers.length && !credentials.length) return { mode: "none" };
  if (headers.length === 1 && credentials.length === 1) {
    const [header, template] = headers[0]!;
    const [secretName, binding] = credentials[0]!;
    const match =
      typeof template === "string" &&
      /^Bearer \{\{\s*secrets\.([A-Z][A-Z0-9_]{0,63})\s*\}\}$/.exec(template);
    if (
      header.toLowerCase() === "authorization" &&
      match &&
      match[1] === secretName &&
      record(binding) &&
      binding.source === "dashboard-secret" &&
      Object.keys(binding).length === 1
    ) {
      return { mode: "bearer", secretName };
    }
  }
  return { mode: "advanced" };
}
export function draftTools(draft: ConnectionDraft | null): string[] {
  return Array.isArray(draft?.tools)
    ? draft.tools.filter((tool): tool is string => typeof tool === "string")
    : [];
}
export function draftValidation(
  draft: ConnectionDraft | null,
  existingId?: string,
  requireTools = true,
): string | null {
  if (!draft)
    return "Enter a valid JSON object in Advanced JSON before continuing.";
  if (existingId && draft.id !== existingId)
    return "The connection ID cannot change. Restore the saved ID in Advanced JSON.";
  if (typeof draft.id !== "string" || !/^[a-z][a-z0-9_]{0,31}$/.test(draft.id))
    return "Use a connection ID starting with a lowercase letter, followed by up to 31 lowercase letters, numbers or underscores.";
  try {
    const url = new URL(String(draft.url ?? ""));
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      /[{}$]/.test(String(draft.url))
    )
      throw new Error();
  } catch {
    return "Enter an HTTPS MCP URL without credentials, query parameters or a fragment.";
  }
  const tools = draftTools(draft);
  if (tools.length > 20) return "Approve no more than 20 tools per connection.";
  if (
    (requireTools && !tools.length) ||
    tools.some((tool) => !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(tool)) ||
    new Set(tools).size !== tools.length
  )
    return "Select at least one approved tool, or enter unique valid tool names manually.";
  return null;
}
