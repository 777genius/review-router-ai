# context-memory

A small, unpublished TypeScript library for calling native memory engines from an
ordinary application. The library owns provider-neutral capability contracts and
native transport mappings. It has no dependency on ReviewRouter, GitHub, Prisma,
Account Gateway, an agent runtime, or a product model-call interface.

The initial capability is **source extraction preview**. A caller supplies one
selectable source revision plus read-only context. The native engine owns semantic
selection. The library validates bounded, complete results; it does not extract,
verify, deduplicate, or approve facts. Preview output is never publication authority.

`HindsightSourcePreview` calls the native dry-run API. It is unavailable unless the
caller supplies a qualification binding for the exact strict-preview image,
privacy profile, model/mission profile, and single extraction chunk bound. A source
pin or configuration boolean is insufficient qualification. The existing approved
statement storage profile is independent of this transient input capability.

```ts
import { HindsightSourcePreview } from "context-memory";
const preview = new HindsightSourcePreview({
  baseUrl: "http://private-memory:8888",
  apiKey: serviceKey,
  bankForScope: (scope) => deploymentOwnedBank(scope),
  qualification: qualifiedDeploymentReceipt,
});
const result = await preview.preview(
  {
    scope: "project-notes",
    source: {
      id: "turn-42",
      revision: "revision-1",
      body: "A supported observation.",
    },
    readOnlyContext: "Earlier discussion, explicitly nonselectable.",
    maxStatements: 4,
  },
  { deadlineAt: new Date(Date.now() + 25_000) },
);
```

Only `status: complete` may replace a previous selected set. A complete empty list
means native abstention. Overflow, malformed output, timeout, native failure and
missing qualification are explicit non-success results and never successful empty
selection. The adapter performs one request, with no retry or raw-source retention.
It shares an absolute deadline with its caller and bounds input/output bytes.

An ordinary consumer example under `examples/external-consumer` demonstrates use
without product identifiers or credentials. The package is private and has not
been published to a registry; no global package-name availability is claimed.
