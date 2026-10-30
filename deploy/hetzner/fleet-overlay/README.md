# Hetzner fleet env overlay

Replaces the four ReviewRouter app containers (web, api, worker, scan) on the Hetzner production host with
identical copies that differ only in a reviewed set of environment values, mirrored into the canonical runtime
env files. All old containers are stopped before any new one starts and are kept stopped (renamed
`*-before-ovl-<ts>`) for rollback. The image does not change.

Use it for producer registry changes: appending a producer attestation row, moving the Action ref and the
installer tuple. For an image change, replace the containers through the release procedure instead.

```bash
# on the host, as root; spec and custody live under /srv/platform/projects/review-router/releases/
node fleet-overlay.mjs prepare fleet-overlay-<id> overlay-spec.json   # snapshot + CAS baseline
node fleet-overlay.mjs plan    fleet-overlay-<id> overlay-spec.json   # prints key names and value hashes only
node fleet-overlay.mjs apply   fleet-overlay-<id> overlay-spec.json
```

`overlay-spec.json` contains `machineId`, `network`, `expectedImage`, `expectedRevision`, container `names` and
`updates`: `{ key, op: "set" | "appendCsv" | "appendJsonArray", value, roles? }`. A targeted key must already exist
on every targeted role. Values never reach the output. After `apply`, register the producer through the trusted
materializer and promote the workflow channel (see `ai-docs/operations/07-environments-and-release-management.md`).

Notes learned in production:

- Docker reports an unset `HostConfig.OomKillDisable` as `null` on older containers and `false` on new ones; the tool
  treats them as equal.
- A producer release is immutable, including its `modelDispatchProfile`. With several OCR profiles that support
  `account_gateway` and `reviewSkillsVersion` 1, the producer must carry an explicit default profile
  (`modelDispatchProfile.defaultAgentProfileRefs`), otherwise admission fails with `agent_profile_unavailable`.
  The default must point at a profile whose managed OCR release asset (`ocr-v<packageVersion>`) is published.

Tests: `node --test deploy/hetzner/fleet-overlay/fleet-overlay.test.mjs`.
