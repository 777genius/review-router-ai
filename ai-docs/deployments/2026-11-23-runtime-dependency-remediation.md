# Runtime dependency remediation: deployment

- Task ID: `2026-11-23-runtime-dependency-remediation`.
- Goal: use reviewed dependency versions for request validation and the
  subscription runtime while preserving provider and review contracts.
- Affected targets: API, worker, Web and self-hosted application images.
- Implementation PR: [ReviewRouter #959](https://github.com/777genius/review-router-ai/pull/959).
- Implementation reference: prepared from
  `fee731e0d9f7b30975f8aa4b2a4f42e665d6c3dd`; record the final reviewed source
  revision and image selected for release before rollout.
- Dependencies: the [native provider parity task](2026-11-21-native-provider-parity.md)
  when shipping that implementation in the same release, and the existing
  [release process](../operations/07-environments-and-release-management.md).
- Last updated: `2026-11-23`.

## Environment status

| Environment / target | Status      | Actual deployed version / image | Last verified (UTC) | Evidence / next step                                       |
| -------------------- | ----------- | ------------------------------- | ------------------- | ---------------------------------------------------------- |
| staging              | `pending`   | Not verified                    | Not verified        | Select and qualify the exact source and image.             |
| production           | `installed` | `f20a75ed` / `sha256:2a601d6b…` | 2026-11-26          | Fleet installed; live provider acceptance remains pending. |

This task records ordinary application rollout work. It does not authorize a
deployment, provider call, schema change or new activation.

## Applicability and prerequisites

The root `pnpm-workspace.yaml` overrides and generated lockfile select these
versions within the previously resolved major versions:

| Dependency                    | Selected version and official registry metadata                                                                                      | Published advisory                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Zod                           | [4.6.7](https://registry.npmjs.org/zod/4.6.7)                                                                                        | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) |
| MCP TypeScript SDK            | [1.32.2](https://registry.npmjs.org/%40modelcontextprotocol%2Fsdk/1.32.2)                                                            | [GHSA-6prh-2h8m-c8cw](https://github.com/advisories/GHSA-6prh-2h8m-c8cw) |
| Hono Node server              | [2.1.6](https://registry.npmjs.org/%40hono%2Fnode-server/2.1.6)                                                                      | [GHSA-jpvv-r467-5p4w](https://github.com/advisories/GHSA-jpvv-r467-5p4w) |
| Hono                          | [4.13.16](https://registry.npmjs.org/hono/4.13.16)                                                                                   | [GHSA-4m76-xfj5-7975](https://github.com/advisories/GHSA-4m76-xfj5-7975) |
| body-parser                   | [2.4.0](https://registry.npmjs.org/body-parser/2.4.0)                                                                                | [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) |
| fast-uri, existing v3 and v4  | [3.1.9](https://registry.npmjs.org/fast-uri/3.1.9), [4.2.3](https://registry.npmjs.org/fast-uri/4.2.3)                               | [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg) |
| ip-address                    | [10.7.4](https://registry.npmjs.org/ip-address/10.7.4)                                                                               | [GHSA-rxp7-6hxx-x8q5](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5) |
| proxy-addr                    | [2.0.8](https://registry.npmjs.org/proxy-addr/2.0.8)                                                                                 | [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) |
| qs                            | [6.16.1](https://registry.npmjs.org/qs/6.16.1)                                                                                       | [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) |
| body-parser required children | [iconv-lite 0.7.3](https://registry.npmjs.org/iconv-lite/0.7.3), [content-type 2.1.0](https://registry.npmjs.org/content-type/2.1.0) | Required by the selected body-parser manifest.                           |

The AR source remains `c7543bc716411a5f899a790a735d09ed2530f779`; the vendored
Gateway archive and provenance remain unchanged. Other application and development-tool pins remain unchanged; the EF test
fixture update below uses the already accepted root tooling version. The existing global
Hono Node server override retains its already resolved v2 profile.

Official registry metadata and published maintainer advisories support the
selected versions. This establishes a bounded dependency change, not a claim
that an HTTP server or proxy-specific vulnerability was exploitable in RR.
The immutable AR preparation lockfile is separate: an npm warning while
preparing that Git dependency must not be presented as a clean whole-image audit
merely because the application lockfile changed.

### Generated release artifacts

The standalone conversation verifier, Codex Action and conflict runtime are
regenerated by their owning build commands from the selected dependency graph.
The verifier retains an exact Zod version check, now matching the locked 4.6.7,
and its input, bundle and license digests remain mandatory. The Action's
third-party notice records the same selected version. Source-stamp authority,
SDK provenance, runtime source pins and protected-command behavior are unchanged.
Require deterministic artifact checks and existing parser/rejection tests before
selecting the image; updating the lockfile alone does not update bundled code.

### Pinned EF test-fixture toolchain

The two concluding EF contract checks in Source and Certification use the
already adopted [EF 2.1.0 package](https://registry.npmjs.org/%40agent-teams%2Fengineering-foundation/2.1.0).
The feature test dependency now matches that root pin. Its public verifier and
decoder use TypeScript 7.0.2 and declare Node 24/26 support, avoiding the older
fixture's embedded TypeScript 5.9.3 dependency.

The published transport fixture verifies the exact 2.1.0 archive integrity.
The source-built decoder fixture checks out
[`145a3fb20392239fe4979c9e4f06684d6af08848`](https://github.com/agent-teams-ai/engineering-foundation/tree/145a3fb20392239fe4979c9e4f06684d6af08848),
the source identified by the package's
[registry provenance](https://registry.npmjs.org/-/npm/v1/attestations/@agent-teams%2fengineering-foundation@2.1.0),
and uses its [documented Node build profile](https://github.com/agent-teams-ai/engineering-foundation/blob/145a3fb20392239fe4979c9e4f06684d6af08848/README.md#commands)
with the owning [profile runner](https://github.com/agent-teams-ai/engineering-foundation/blob/145a3fb20392239fe4979c9e4f06684d6af08848/tools/dev.mts)
and pinned pnpm 11.20.0. The exact source remains unchanged while the runner
builds an isolated, recorded Node projection. Packaging uses the same owner's
[read-only pack command](https://github.com/agent-teams-ai/engineering-foundation/blob/145a3fb20392239fe4979c9e4f06684d6af08848/tools/pnpm-command.mts),
with engine checks retained. The source-built fixture records its own archive and exact-byte
PostgreSQL evidence; it does not claim byte identity with the published archive.

The global CI and production Node 26.11.1 profile remains unchanged. Earlier
EF 1.6.0/1.6.1 archives and receipts keep their original identities as historical
evidence. The existing v3 transport, decoder, rejection and protected-command
assertions remain required. This changes only test tooling: G1 remains `hold`
and no production route, verifier assignment or publication path is activated.

## Ordered rollout

1. Follow the release process, reconcile the installed fleet and select the
   exact reviewed source/image containing this lockfile. Preserve applicable
   provider-parity rollout and rollback requirements.
2. Require the normal frozen managed install, strict peer checks, semantic
   typechecking, affected request/provider tests and owning image checks for
   that source. Preserve compiler, sandbox and offline-generation constraints.
3. Deploy the ordinary API, worker and Web application image through the
   existing release path. This dependency change adds no migration, secret,
   feature flag or activation step.
4. Verify actual installed package identities, application readiness, valid and
   invalid request handling, and the already qualified provider/review paths.
   Record the image/source, environment, operator, UTC time and durable evidence.

## Verification and completion

- The shipped graph resolves the selected versions with the reviewed lockfile
  integrities and unchanged AR/Gateway source identities.
- Oversized or invalid request collections are rejected at existing validation
  boundaries; valid provider setup, review and checkpoint requests still work.
- Dependency checks do not replace required E2E, source qualification or
  environment evidence. Local checks and green PR CI alone are not deployment.
- Any remaining advisory warning retains its package, version and execution
  scope; no blanket exception or zero-vulnerability assertion is implied.

## Retry, partial completion and rollback

Inspect the currently installed image and each role before retrying. Use the
existing release rollback process with a previously qualified image and preserve
all database state and provider-parity reader requirements. Rolling back the
application image may restore affected dependency versions; record that residual
risk and the follow-up rather than marking this remediation deployed.

## Related links

- [Dependency pinning policy](../operations/11-dependency-pinning-policy.md).
- [Supply-chain policy](../operations/06-supply-chain-security.md).
- [Quality gates](../operations/03-quality-gates.md).
- [Release process](../operations/07-environments-and-release-management.md).

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result         | Evidence | Next action                         |
| ------------ | -------------------- | ---------- | ---------------------- | -------------------------------- | -------- | ----------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Implementation preparation only. | PR #959  | Qualify and select a release first. |

## Production installation — 2026-11-26

RR `f20a75edbc7eff11be4f2423fb2e723f6e484223`, image `sha256:2a601d6bffaebea0c2cdd4e1cf82c95a10312136b173f56e837f15a09aa0d810`, installed across the fleet with the coordinated Gateway/native producer update. Fleet readiness passed; task-specific provider acceptance remains pending.
