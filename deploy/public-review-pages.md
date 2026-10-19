# Public review documents

The authoritative documents are the HTML files in
`apps/web/public/paddle-review/`. Next.js serves those same files through the
public legal route handlers. Their content is public and needs no session or
database access.

The current production web runtime has separately controlled release and
database boundaries. Publish this static bundle through Caddy to update the
public documents without replacing that runtime or changing its credentials.
This is a narrow public-content deployment, not a runtime release.

Create a fresh artifact from the reviewed commit:

```sh
node scripts/build-public-review-pages.ts tmp/public-review-output
```

The manifest records the source commit and SHA-256 of every published file.
Copy the verified artifact to an immutable project release directory, then
record `/srv/platform/public-web/review-router/current` as its pointer.
In the installed Caddy snippet, replace the template root with that immutable
release path; serving never follows a mutable release pointer.

Install `public-review-pages.caddy` in the project's Caddy configuration. The
`rr-web-backend` generator in `/etc/platform/projects/review-router/apply-domain.sh`
must emit `import rr-public-review-pages` followed by the original reverse proxy
inside a fallback `handle` block. Preserve the API and gateway blocks. Do not
execute the domain-application script for this content change: it also rewrites
runtime environment files. Update its generated web block atomically using the
same reviewed text, validate the complete Caddy configuration, then reload.

Before publishing, retain the exact original generator, web configuration,
snippet state and current-link target. Check that those files have not changed
since inspection. If validation, reload or route checks fail, restore those
exact files and the link, then reload the previously valid configuration.

Verify the four HTTPS document routes, the stylesheet, mobile layout, and
navigation from the homepage's existing Terms and Privacy links. No API,
database, account credentials, customer reviews or checkout is changed.
