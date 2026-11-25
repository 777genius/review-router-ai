# Skills security execution service

This is ReviewRouter's private execution adapter for [NVIDIA SkillSpector](https://github.com/NVIDIA/SkillSpector). The application owns authorization, immutable candidates, job admission, receipts, limits and import decisions. This service accepts one fixed text document and returns the native report after the scanner and its model connections have stopped.

The implemented scope and the two rounds of plan review are recorded in [the implementation plan](../../ai-docs/plans/2026-10-27-skills-catalog-security.md). Source resolution is implemented separately in `777genius/universal-agent-plugins` at `POST /v1/skills/resolve`.

## Operator setup

Use the repository's [release process](../../ai-docs/operations/07-environments-and-release-management.md) for database migrations and runtime grant activation. Migration `000150_skills_catalog_security` adds only the candidate and scan tables. Existing web and worker identities receive narrowly scoped table and column grants through the existing activation tooling. The scanner container receives no database credentials.

Configure the web process with:

| Variable                                       | Purpose                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `REVIEW_ROUTER_SKILLS_CATALOG_URL`             | Fixed UAP service origin; defaults to `https://api.universal-agent-plugins.com`.                                               |
| `REVIEW_ROUTER_SKILLS_CATALOG_TOKEN`           | Service token for the authenticated UAP resolver. Search remains anonymous on the UAP side.                                    |
| `REVIEW_ROUTER_SKILL_SCAN_WORKER_ENABLED=true` | Explicitly enable admission after the dedicated worker has been provisioned.                                                   |
| `REVIEW_ROUTER_SKILL_SCANNER_URL`              | Private scanner origin, normally `http://skill-scanner:8081`.                                                                  |
| `REVIEW_ROUTER_SKILL_SCANNER_TOKEN`            | Private ASCII bearer token, 32–256 non-whitespace characters. Use the same value for the web process, scan worker and scanner. |

The dedicated worker needs the last three variables and its existing worker database configuration. Start the built worker with `pnpm --filter @reviewrouter/worker skills:start`; development uses `skills:dev`. Run this as a separate process from the ordinary review worker. It claims only `review-skills.scan` events, one at a time, through the existing fenced outbox. Do not add the scanner handler to the ordinary worker's batch.

Use the same immutable application image revision as web/API/worker for the dedicated skills worker; override its command with `node --conditions=production apps/worker/dist/skill-scan-worker.js` from the application image's `/app` working directory. It needs the existing worker database role and runtime grants, not the web role or database owner. The scanner and egress proxy use the separate scanner image built by the composition below. Do not reuse an application image as the scanner image.

Start the execution service using the supplied composition:

```sh
docker compose -f services/skill-scanner/compose.yaml up --build --detach
```

Attach the web process and dedicated scan worker to the composition's `skill-scan-private` network, or provide an authenticated private HTTPS route to the same service. The default HTTP origin is available only to containers on that network; there is no published host port. The web process reads profiles; only the worker submits executions. Keep the token and service route private.

The scanner has a read-only root, UID 10001, no Linux capabilities, no-new-privileges, a 1 GiB memory limit, 64-process limit, one CPU and a private 32 MiB temporary filesystem. Startup verifies the key filesystem, privilege and cgroup bounds. `/scan` contains one temporary document and report, and is cleared after each confirmed execution.

The separate egress proxy is the scanner network's route to approved external dependencies. It allows TLS tunnels to `api.osv.dev` and the three supported model hosts only; it rejects private address resolution, alternate ports and other hosts. Each tunnel has an aggregate 2 MiB transfer bound and a 60-second lifetime. Static analysis can query OSV when applicable; it does not call an LLM. The scanner cannot connect directly to the public Internet.

The UAP resolver must be deployed with its separate service token and bounded Linux runtime before catalog previews can work. Merging application source does not provision or deploy either service. Missing resolver/scanner configuration produces an unavailable state; it does not allow unchecked catalog import.

## Rollout and acceptance

The application environment examples leave scan admission disabled. Provision the UAP resolver and its token first, then the private scanner network, scanner/egress services and dedicated skills worker. Supply the resolver token to web only, and the scanner origin/token to web and the dedicated skills worker. Set `REVIEW_ROUTER_SKILL_SCAN_WORKER_ENABLED=true` in those two processes after their prerequisites are ready. The ordinary review worker does not need scan admission enabled.

A running dashboard and a successful catalog search do not qualify this rollout: search uses an anonymous endpoint and does not exercise resolution or scanning. Verify the deployed configuration without printing secret values, then use a disposable workspace/repository to complete this authenticated browser path:

1. Browse or search the live UAP catalog and open a supported public GitHub skill's Preview.
2. Confirm the instructions load, run a static check, and wait for a complete result from the dedicated worker.
3. Add the checked text to the library, confirm it appears once, and complete the existing repository-assignment flow.
4. Reopen the imported library skill and confirm the saved text and assignment. Remove the disposable test skill/assignment after recording the result.

Record the application and scanner image revisions with the result. Keep AI checking disabled unless its separate model configuration and consent path have also been qualified. To stop new scan admission, set the enable flag to `false` in web; preserve the dedicated worker and scanner until any admitted work has reached a terminal state.

## Optional AI profile

Static checks work without a model account. To offer the additional AI checkbox, configure all three scanner variables together:

| Variable                  | Accepted value                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SKILL_SCANNER_LLM_URL`   | HTTPS origin plus `/v1` or `/api/v1` on `api.openai.com`, `openrouter.ai` or `integrate.api.nvidia.com`. No credentials, query or fragment in the URL. |
| `SKILL_SCANNER_LLM_MODEL` | One fixed operator-selected model ID, at most 128 characters.                                                                                          |
| `SKILL_SCANNER_LLM_KEY`   | A scoped key for that provider.                                                                                                                        |

The CLI receives a temporary loopback relay token. The real provider key stays in the trusted per-job supervisor and is never placed in the scanner's environment or temporary files. The supervisor and CLI share one process group; timeout termination closes model sockets as well as the scanning process. Parent-death signals terminate the child chain if its supervisor disappears.

An AI execution permits at most four attempted provider requests, including failures. Each request has at most 128 KiB of JSON input and requests at most 2,048 output tokens. Streaming, multiple responses, remote media and unsupported request fields are rejected. The entire execution has a 180-second deadline; static execution has 90 seconds. These are request and concurrency bounds, not a guarantee of a particular provider bill or model latency. No automatic second physical execution follows a crashed or uncertain scan.

The UI explicitly asks before sending the skill text to the configured analysis provider. A static result cannot satisfy an AI-selected import. Native analysis that is partial, degraded or malformed is treated as incomplete; high or critical findings block import. Lower-severity findings require acknowledgement. A clear result means that the completed checks found no reported issue, and is not a guarantee of safety.

## Identity, retries and limits

SkillSpector is pinned to release 2.13.1, source revision `f3b25697d76256998ca9d42c198d256258d4c035`. Both Python dependency sets are hash-locked. The image pins its Python base digest and preloads tokenizer assets at build time. Profile identity includes the scanner revision, service source, dependency locks, Dockerfile, Python runtime, policy and model configuration. Any change to these inputs invalidates previous profile-bound results.

The application hashes the exact canonical text used for both scanning and import. Raw UAP source has a separate hash. Source content and authority are revalidated server-side; browser IDs never confer permission. Import uses the existing Skills creation flow and a transactional receipt. Resending the same successful operation returns the existing library skill instead of creating a duplicate.

The existing PostgreSQL rate limiter handles reusable weighted costs. New job admission, quota reservations and the outbox event commit in one transaction. Search/resolve/status requests also use the same limiter. Current quotas live in `apps/web/src/server/skill-catalog-rate-limits.ts`, so the operator documentation does not duplicate a second editable quota configuration. Queue capacity is 64 globally, eight per workspace and four per user; a queued job expires after ten minutes. One physical scan may be active at a time. Cached results and operation receipts do not consume a second physical-job reservation.

If the service cannot confirm that its process group stopped, it returns no `executionFinished` acknowledgement, hides its profiles and keeps its execution permit closed. Restart the whole scanner container after investigating that condition. Restarting only a request or clearing a database slot is insufficient. The application marks uncertain work incomplete and keeps its slot through the recorded deadline plus a termination margin; it does not resend the job.

## Verification

`.github/workflows/skill-scanner.yml` builds the exact image, runs real SkillSpector static and AI workflows with the network disabled and a loopback model fixture, and checks process termination, failed-call charging, replay protection and bounded responses. It then starts the actual production composition and verifies authenticated native reports, non-root/read-only/cgroup bounds, an actual 32 MiB `ENOSPC`, scratch cleanup, denied direct egress and denied proxy destinations. The receipt records the candidate Git revision and actual scanner build identity.

The separate catalog job in `.github/workflows/skills-browser.yml` runs the real Next application, authenticated sessions, fresh PostgreSQL migrations, dedicated worker and pinned scanner. UAP and the model provider are loopback fixtures. It covers preview, native clear/warning/blocked results, acknowledgements, source ambiguity, loss of a reply, unavailable/incomplete results, static/AI separation, exact import and existing repository assignment. Desktop and mobile screenshots are retained. These tests qualify the integration and failure boundaries; they do not claim a paid provider or a production deployment was exercised.

For local scanner checks, install `build-requirements.lock` and then `requirements.lock` with `pip --require-hashes`; use `--no-build-isolation` for the latter. Run:

```sh
python -m unittest discover -s services/skill-scanner -p test_server.py -v
```

`test_service.py serve` is an explicit local browser-test launcher that does not claim container isolation. `--with-loopback-ai` starts its own synthetic provider and never reads ambient model credentials. Neither this launcher nor its model fixture is copied into the production image.

## License

NVIDIA SkillSpector is distributed under Apache-2.0. Its source and installed distribution retain the upstream license and notices. The pinned source archive and hash are recorded in `requirements.lock`; no upstream scanner implementation is copied into this repository.
