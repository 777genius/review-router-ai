// Qualification-only preload: existing catalog probes cannot escape loopback.
const originalFetch = globalThis.fetch;
globalThis.fetch = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname))
    return Promise.reject(new Error("skills_e2e_external_fetch_blocked"));
  return originalFetch(input, init);
};
