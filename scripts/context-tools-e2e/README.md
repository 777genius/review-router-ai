# MCP browser acceptance

`runContextToolsBrowserAcceptance` is an executable acceptance suite for an
explicitly supplied authenticated Playwright `Page`. It does not launch or attach
to a browser, access a profile/cookie file, impersonate an owner, intercept
requests, or replace server responses. The caller owns the page and permission
to use its workspace. Use fresh disposable connection IDs.

```ts
import { runContextToolsBrowserAcceptance } from "./browser-acceptance.ts";

await runContextToolsBrowserAcceptance({
  page, // existing, explicitly owned authenticated test page
  stalePage, // optional second explicitly owned page in the same test session
  origin: "https://reviewrouter.org",
  workspaceId: approvedTestWorkspaceId,
  connectionPrefix: "e2e_20261023_a1",
  outputDirectory: "/absolute/owned/workspace/tmp/context-tools-browser/run-a1",
  presets: [
    {
      label: "DeepWiki",
      endpoint: "https://mcp.deepwiki.com/mcp",
      tool: "read_wiki_structure",
    },
    {
      label: "Microsoft Learn",
      endpoint: "https://learn.microsoft.com/api/mcp",
      tool: "microsoft_docs_search",
    },
    {
      label: "Cloudflare documentation",
      endpoint: "https://docs.mcp.cloudflare.com/mcp",
      tool: "search_cloudflare_documentation",
      // Set catalogName to the exact available pinned UAP label to also verify
      // its picker and provenance-driven prefill, rather than custom entry.
    },
  ],
  // Set only when a real public HTTPS fixture's unauthenticated HTTP 401 response
  // has been independently established. Omission is reported as untested.
  // authenticationFailureEndpoint: "https://owned-test-fixture.example/mcp",
});
```

Endpoint/tool names are explicit run inputs: public services can change. Verify
their current official endpoints and the pinned catalog before execution. A
catalog entry must exist and be supported to supply `catalogName`; the suite
does not invent presets for absent upstream entries.

The suite exercises desktop (1440px) and mobile (390px) in both themes, checks
horizontal overflow, and saves screenshots for human visual review. It drives
the actual form to initialize/discover a remote anonymous MCP server, approves
one discovered tool, roundtrips through Advanced JSON, saves, reloads, and verifies
the persisted definition. It rejects private/loopback/insecure endpoints through
the actual form. With `stalePage`, it submits and probes an obsolete saved
revision and requires the visible conflict error. A real optional 401 fixture
checks the visible authentication error without using an API key.

Created connections are disabled through the UI after each case and during
failure cleanup. An interrupted save may have persisted, so the ID is tracked
before submission. Cleanup failures are recorded with exact IDs in
`acceptance.public.json` and must be reconciled before another run. Existing
connections and review policies are never edited. Theme preference and viewport
are restored; the caller closes its own tabs.

This suite deliberately does not invoke an MCP tool or model. A successful
handshake is not proof of an OCR invocation or API-key authentication. Retain
the separate disposable-repository policy/OCR canary's exact producer, PR/head,
workflow run, native tool receipt and cleanup evidence. API-key success needs
its own isolated HTTPS fixture and throwaway credential; do not substitute a
mock or a failed 401 response as that proof.

For the owner's existing Brave session, use the installed `brave-real-browser`
plugin with a unique task ID and its explicitly returned owned target. Follow
the same scenarios through that adapter; do not connect a Playwright client to
the main profile or attach to unrelated tabs. The exported Page suite is also
usable in the repository's isolated authenticated browser fixture. Report which
driver actually ran; preparing or typechecking this suite is not live evidence.

After the page is supplied, execution uses ordinary UI locators and real network
responses. There is no production test hook or auth bypass.
