# MiMo Worker Capacity and Bridge Job Launch Runbook

Operational runbook for running MiMo-hosted jobs (`mimo-v2.6-pro` through the
`mimo-token-plan` backend) on subscription-runtime worker hosts via the
MimoProject bridge. Metadata-only: never paste provider secrets, credentials,
prompts, or model responses into logs, tickets, or docs.

## Launch sequence (strict order)

Use `scripts/worker-ops/mimo-bridge-job-launch.py`. The bridge launch has one
non-obvious invariant: the workspace must not change while the `start`
operation is in flight.

1. `create` with the new `jobId` (reuse the previous job's create request
   envelope) and poll until the observation reaches `state: "settled"` with an
   ok result.
2. `start` and poll until `state: "settled"` (a `running` observation is only
   the unit report, not launch confirmation).
3. Confirm the on-disk truth: `<state-root>/<project>/<workstream>/mimo-bridge-operations/<jobId>.start.result.json`
   has `ok: true` and no error.
4. Only then stage the plan/reference files into the workspace.

Staging earlier fails the start with
`project_control_workspace_state_changed_before_start` and the job never
launches. The launcher strips AppleDouble `._*` files after staging; they
otherwise pollute the workspace diff.

Exit codes: `0` launched and staged, `3` create failed, `4` start not confirmed
or staging skipped.

## Capacity gate mechanics

- The gate lives in the capacity store namespace of the pool account that owns
  the MiMo credential (for example
  `/srv/worker-state/account-pools/.subscription-runtime-account-capacity/<digest>/mimo-token-plan/`).
- A provider limit writes `quota_limited`, then a cooldown
  (`worker_account_capacity_time_to_reset_ms`, ≈15 min) leads to a
  `recheck_due` phase. Jobs without a capacity rechecker burn their single
  `maxAccountCycles` attempt on admission
  (`quota_recheck_unavailable` / `subscription_worker_account_available`).
- Generic pool/quota CLI tools report against the OpenAI namespace and do not
  touch the MiMo namespace. Do not hand-edit registry, lease, or store files.

### Operator gate clear

`scripts/worker-ops/mimo-capacity-clear.mjs` resets the gate record through the
store API (`tryClaimRecheck` with `Refresh`, then `resolveRecheck` with
`Available`). `scripts/worker-ops/mimo-capacity-state.mjs` dumps the current
phase/capacity read-only. Both default to
`MODEL_BACKEND=xiaomi-mimo-token-plan`, `ACCOUNT_ID=account-q`, and
`POOL_DIR=/srv/worker-state/account-pools/live-codex-auth` (overridable via
env); the `mimo-token-plan` name above is the store namespace segment, not a
valid `MODEL_BACKEND` value.

Clearing the gate record does **not** clear provider-side quota: the first
provider request writes a fresh limit right back if the quota is truly
exhausted. Treat the clear as "remove our stale block", not "capacity is back".

## Diagnosing a quota block vs a gate block

- Provider quota block: the job starts, reaches the provider, and dies on
  request #1 with `codex_app_server_turn_error … 502
{"code":"proxy_upstream_failed","upstream_status":429}`, `outputObserved:
false`, attempt journal `status=blocked reason=quota_limited`. Other projects'
  jobs on the same account fail the same way within minutes — the account is
  limited, not the job.
- Gate block: the job fails at admission with `account_unavailable` /
  `quota_recheck_unavailable` and never reaches the provider.
- A passing account "quota live check" covers a different quota counter than
  the MiMo route; it does not prove MiMo capacity.

## Probe cadence when quota-blocked

- At most one probe job per window: minimum 30 minutes apart, backing off to
  hours after repeated identical failures.
- After three identical provider-quota failures, stop probing and report. The
  unblock is one of: top-up the purchased token-plan credits, re-login the
  account (device-auth; it helps only if the limit is account-scoped), or wait
  out an hourly/daily window.
- `scripts/worker-ops/mimo-quota-window-watch.py` passively scans attempt
  journals and exits with `WINDOW_OPEN` when a recent journal change shows
  observed output (`outputObserved` is serialized as the string `"true"`) or the
  last attempt status is `completed`/`succeeded`/`running` — any job getting
  that far means the account has capacity. Run it under `nohup`, probe once
  after it fires.
- Never substitute a different model to work around a MiMo quota block.

## Stopping a job

The bridge `stop` operation is protective: for a fresh live worker it returns
`project_control_fresh_worker_stop_denied` with the required state and a
`stopCommand` naming the exact tmux session. Execute that `tmux kill-session -t
<jobId>` command, then `pkill -f <jobId>` and verify no processes remain. The
job's `progress.json` may keep a stale `status: "running"` after the process
tree is dead — trust the process table, not the file.

## Hard rules

- MiMo models only for MiMo-hosted jobs; report the limitation instead of
  substituting another model family.
- Use the installed broker/controller/bridge APIs. No guessed command names, no
  manual registry, lease, or state edits.
- Never read or copy credentials (`auth.json`, `encryption-key.hex`).
- A successful job launch alone is not proof of completed work.
- Production service, data, or DNS changes need separate approval.
