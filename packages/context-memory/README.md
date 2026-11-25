# context-memory

A small, unpublished TypeScript library for calling native memory engines from an
ordinary application. The library owns provider-neutral capability contracts and
native transport mappings. It has no dependency on ReviewRouter, GitHub, Prisma,
Account Gateway, an agent runtime, or a product model-call interface.

The initial capabilities are **source extraction preview**, **current source read/list**, **exact statement replace**, **native operation observation**, and **native recall evidence**. `HindsightMemoryStore` uses the pinned native SDK for these mechanisms. Operation completion is separate from application publication: callers must verify their own current-body and revision contract. Reflect and complete physical forget remain explicitly unavailable in this library; applications retain their existing qualified cleanup owner.

For exact statement replacement, the deployment provisions a named retain strategy
with `retain_extraction_mode: "chunks"` in each addressed bank. The writer reads
that bank's configuration before every submission and rejects missing, semantic
or malformed strategies with `MemoryEngineError("unsupported")` before retaining
anything. It never provisions or changes banks. Native configuration transport
failure is `unavailable`; an unchecked strategy name is never proof of exact
persistence. Preview qualification remains a separate prerequisite.

For source extraction preview, a caller supplies **one selected source revision**
and may supply complete transient `readOnlyContext` to resolve its references and
endorsements. The host owns context verification, author identity and permission;
the portable library does not infer those from text. Source and context remain
distinct in the native request. Without context, selection remains source-only.

The native engine owns semantic selection. The library validates bounded, complete
results; it does not extract, semantically verify, deduplicate, or approve facts.
The extraction task distinguishes a current author's decision from foreign
instructions, quotations, negations and unresolved disputes. These are semantic
requirements to evaluate on actual models, not deterministic guarantees supplied
by a prompt. Preview output never grants publication authority. The application
chooses whether to admit permitted changes or request human confirmation.

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
  mission: qualifiedExtractionMission, // Must match the receipt’s mission digest.
});
const result = await preview.preview(
  {
    scope: "project-notes",
    source: {
      id: "turn-42",
      revision: "revision-1",
      body: "A supported observation.",
    },
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
