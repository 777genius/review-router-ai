# Account concurrency and companion admission rollout

Production application source 8561576c61abcead21419520e9bc350446017fc5 is installed on API, worker, scan and web. Image sha256:1962f5e6f60e465a5d902c28bf8f4a2f35280b88186f9d0c8d79fdd49f039b9c. All roles run without restarts, seven worker privileges passed, and readiness returned HTTP 200.

Gateway source 27f1f8db5620077b9fd4b694ca39644fcd14adf3 is active at /srv/platform/artifacts/review-router/account-gateway/releases/coherent-27f1f8d-f2de-node26/release. The source removes shared account concurrency admission and advertises retry only before kernel request admission. Native source remains f2deab244b62469cebfa1492e70d80a4f766dc1f. Node 26 build and typecheck passed on the host. PostgreSQL and full-stack CI passed. The Node 24 native-client qualification reported an aggregate failure while its twenty reported cases passed; the deployed Node 26 native-client qualification passed.

The application includes merged memory repairs #804/#805 and #807. Explicit undecided status is filtered before automatic persistence. Semantic acceptance on the live model remains pending.

Rollback fleets and previous Gateway release are retained. Production cutover used fleet-overlay-8561576c-faDcPec6. No schema migration was required by these changes.

Fresh review acceptance is running as attempt 2 of https://github.com/777genius/agent-teams-ai/actions/runs/41675031614. Live review, usage and semantic memory acceptance remain pending.
