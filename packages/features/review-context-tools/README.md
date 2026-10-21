# Review context tools

Context tools are optional and available only for OpenCodeReview through Account Gateway with Agentic context enabled and a compatible approved Action release. Selecting a tool makes its availability required for that review. An unavailable connection, missing secret, unsupported engine, or missing tool fails before inference; a later backend failure is reported as incomplete context. No tools are enabled by default.

Workspace owners or admins create HTTPS connections in Dashboard → Context tools. Store the URL and explicit tool allowlist, then use either Dashboard credentials or named GitHub secrets. Dashboard credentials are encrypted separately from provider accounts and are delivered only to the parent broker for the live admitted run. Neither secret values nor remote headers enter the model or the native child environment.

Example connection definition:

```json
{
  "id": "docs",
  "url": "https://mcp.example.com/mcp",
  "headers": {"Authorization": "Bearer {{ secrets.DOCS_TOKEN }}"},
  "tools": ["search_docs"],
  "credentials": {
    "DOCS_TOKEN": {"source": "github-secret", "name": "DOCS_MCP_TOKEN"}
  }
}
```

`${{ secrets.DOCS_TOKEN }}` is also accepted in a header template. It names a logical broker key; arbitrary configuration does not cause a GitHub secret API lookup. For a Dashboard credential use `{"source":"dashboard-secret"}` and enter the value in the separate password field.

Select the approved connection and tool subset in repository policy. Alternatively, commit this `.reviewrouter.json` to the repository's default branch and click **Import default-branch config**, inspect the preview, then save policy with the normal version check:

```json
{
  "contextTools": {
    "version": 1,
    "builtinTools": ["github.issue.read"],
    "mcp": [{"connection": "docs", "tools": ["search_docs"]}]
  }
}
```

The import reads a fixed file at the verified default-branch commit. PR-head URLs, headers, or credential definitions are never imported into execution authority. `github.issue.read` requires existing GitHub App issue-read permission and reads only linked issues in the admitted repository. `repository.docs.read` is optional and disabled by default; ordinary checkout file tools remain available independently.

For GitHub-held credentials, the caller must explicitly bind the selected logical names to the exact approved GitHub secret names:

```yaml
secrets:
  mcp_secrets_json: ${{ format('{{"DOCS_TOKEN":{0}}}', toJSON(secrets.DOCS_MCP_TOKEN)) }}
```

Only this opaque named bundle is forwarded through reusable workflow layers. Never use `secrets: inherit`, `toJSON(secrets)`, dynamic secret indexing, or a repository-wide secret dump. A caller with no MCP selection retains the original canonical bytes. Installing the compatible reusable workflow must precede enabling a secret-bearing selection; older approved producers do not gain MCP capability from sharing the same native binary.

The broker accepts HTTPS only, rejects redirects and unsafe DNS/IP destinations, applies the selected tool allowlist and finite timeout/response/call limits, and treats every remote description and result as untrusted context. It does not accept arbitrary local commands or stdio servers.
