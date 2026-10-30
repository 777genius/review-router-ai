# Hetzner fleet env overlay

Replaces the four ReviewRouter app containers (web, api, worker, scan) on the Hetzner production host with
identical copies that differ only in a reviewed set of environment values, mirrored into the canonical runtime
env files. All old containers are stopped before any new one starts and are kept stopped (renamed
`*-before-ovl-<ts>`) for rollback. The image does not change.

Use it for producer registry changes: appending a producer attestation row, moving the Action ref and the
installer tuple. For an image change, replace the containers through the release procedure instead.

```bash
# on the host, as root; the spec and the custody directory live under /srv/platform/projects/review-router/releases/
# Copy fleet-overlay.mjs and cutover.mjs together; the custody directory must not exist yet.
R=/srv/platform/projects/review-router/releases
node fleet-overlay.mjs prepare $R/fleet-overlay-<id> $R/overlay-inputs-<id>/overlay-spec.json   # snapshot + CAS baseline
node fleet-overlay.mjs plan    $R/fleet-overlay-<id> $R/overlay-inputs-<id>/overlay-spec.json   # key names, value hashes, extra hosts
node fleet-overlay.mjs apply   $R/fleet-overlay-<id> $R/overlay-inputs-<id>/overlay-spec.json
```

`overlay-spec.json` is owned by root with mode 0600 and contains `machineId`, `network`, `expectedImage`,
`expectedRevision`, container `names`, `updates` and optionally `extraHosts`:

- `updates`: `{ key, op: "set" | "appendCsv" | "appendJsonArray", value, roles?, containerOnly? }`. A targeted key must
  already exist on every targeted role, and in the canonical env file exactly once, unless `containerOnly` is set
  (for values that were injected at container creation and are not in the canonical file). `set`/`appendCsv` values
  are non-empty strings without control characters; `appendJsonArray` takes an object.
- `extraHosts`: `{ entry: "host:ip", roles? }` appended to the container `ExtraHosts` (kept existing entries).

The plan output shows a sha256 prefix and length of each value, never the value. `snapshot.json` in the custody
directory keeps the canonical env files (root, 0600) so the run can be rolled back; delete the custody directory
after the change is verified.

Failure handling: if anything fails after the cutover started (a stop/rename/start error, a changed container, a
container that is not running and restart-free 20 seconds after the last start), the tool stops the new containers,
renames them `*-ovl-failed-<ts>`, restores the canonical env files from the snapshot, and starts the old containers
under their original names. The receipt phase then reads `rolled_back_after:<phase>` (or `rollback_failed_after:`,
which needs manual `docker` recovery). Retained old containers of a successful run are `*-before-ovl-<ts>`. A run
always recreates the whole fleet, even when nothing changes, so expect a short outage.

After `apply`, register the producer through the trusted materializer and promote the workflow channel (see
`ai-docs/operations/07-environments-and-release-management.md`).

Notes learned in production:

- Docker reports an unset `HostConfig.OomKillDisable` as `null` on older containers and `false` on new ones; the tool
  treats them as equal.
- A producer release is immutable, including its `modelDispatchProfile`. With several OCR profiles that support
  `account_gateway` and `reviewSkillsVersion` 1, the producer must carry an explicit default profile
  (`modelDispatchProfile.defaultAgentProfileRefs`), otherwise admission fails with `agent_profile_unavailable`.
  The default must point at a profile whose managed OCR release asset (`ocr-v<packageVersion>`) is published.

Tests (not part of the CI test command): `node --test deploy/hetzner/fleet-overlay/fleet-overlay.node-test.mjs`.
