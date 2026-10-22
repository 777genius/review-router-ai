# Review context tools

This package owns versioned workspace HTTPS connection metadata, encrypted Dashboard credentials, explicit GitHub-secret references, and captured OCR tool plans. Default selection is absent. Selected tools are required, and only an approved producer with the exact `contextToolsContract` descriptor may capture a plan.

The customer configuration guide belongs to the public Action repository at `docs/https-mcp-context.md`. It documents Dashboard setup, the fixed `.reviewrouter.json` default-branch import, both header-template spellings, and the explicitly named `mcp_secrets_json` caller binding. The import returns a preview; the existing policy Save/CAS remains the write authority.

Dashboard secret delivery requires the normal live admitted-run bearer and current workspace connection revisions. GitHub secrets remain on the runner. The parent broker holds HTTPS credentials and passes only a loopback capability to the native OCR child; remote tool output remains untrusted. No native binary change or default tool activation is part of this package.
