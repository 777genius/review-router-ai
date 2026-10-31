# GitLab OIDC issuer-bound repository resolution

Date: 2026-10-31
Baseline: `e0fb3391f69cb69941b8a72233a120dcd4fcbf29`
Status: draft implementation.

## Proven failure
The GitLab CI ID-token is JWT-verified, but `exchangeGitLabCiIdToken` looks up `job_project_id ?? project_id` without passing the verified `iss`. Prisma finds a first selected record by numeric GitLab ID regardless of source URL. Self-hosted GitLab servers may allocate the same project ID and path, so a verified job from one issuer can be mapped to a different workspace. The static registry and fallback similarly do not scope source. A deselected DB repository can fall back to static configuration and accidentally regain access.

## Bounded contract
- Pass the verified issuer through the feature-owned GitLabRepositoryPort as part of an immutable project lookup key.
- Normalize HTTPS origins with the existing GitLab source normalization rules. Reject malformed issuer rather than fall back; GitLab.com static records retain default issuer when config omits sourceBaseUrl.
- Database adapter must match sourceBaseUrl, provider and projectId, keep active/selected policy. Static registry must key by the exact tuple and reject ambiguous duplicates. Fallback must not resurrect a record that was deliberately denied/deselected in database; distinguish absent from denied only where necessary and avoid a new generic auth framework.
- No change to JWT signature/audience verification or SCM mutation gateway; no new configuration flag or database migration.

## Qualification
Cross-issuer duplicate numeric/project path, static fallback, DB deselection precedence, verified-claim lookup, missing issuer, active/removed installation, native API typecheck, package tests, E2E CI and code/security review; fix confirmed findings.

## Rollout
Coherent API code rollout with existing configuration. Register pending environment task.