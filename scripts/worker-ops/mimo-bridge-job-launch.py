#!/usr/bin/env python3
"""Relaunch a MimoProject bridge job under a new job id with safe plan staging."""

import argparse
import json
import os
import subprocess
import sys
import time

BRIDGE_CLI = [
    "/usr/local/bin/node",
    "/opt/subscription-runtime/mimo-project-bridge-current/dist/worker-codex/hosted-mimo-project-bridge-cli.js",
]
STATE_ROOT = "/srv/worker-state/mimo-projects"
WORKSPACES_ROOT = "/srv/workers/mimo-projects"


def stamp():
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"


def call(req, tag):
    p = subprocess.run(BRIDGE_CLI, input=json.dumps(req), capture_output=True, text=True)
    out = p.stdout.strip()
    print("%s %s rc=%d %s" % (stamp(), tag, p.returncode, out[:800]), flush=True)
    if p.stderr.strip():
        sys.stderr.write(p.stderr)
    try:
        return json.loads(out)
    except Exception:
        return None


def obs_of(r):
    if not isinstance(r, dict):
        return {}
    v = r.get("result")
    return v if isinstance(v, dict) else {}


def result_ok(res):
    if not isinstance(res, dict) or res.get("ok") is not True or res.get("error"):
        return False
    inner = res.get("result")
    if isinstance(inner, dict) and inner.get("ok") is False:
        return False
    return True


def poll(req, tag, settle_tag, max_polls):
    r = call(req, tag)
    seen_running = False
    for _ in range(max_polls):
        obs = obs_of(r)
        st = obs.get("state")
        if st == "settled":
            res = obs.get("result") or {}
            if result_ok(res):
                print("%s %s %s" % (stamp(), settle_tag, res.get("jobId", "")), flush=True)
                return True
            print("%s %s_FAIL %s" % (stamp(), settle_tag, json.dumps(obs)[:600]), flush=True)
            return False
        if st == "running" and not seen_running:
            seen_running = True
            print("%s %s_UNIT_RUNNING(not-launch) unit=%s" % (stamp(), tag, obs.get("unit")), flush=True)
        if r is not None and not obs:
            print("%s %s_BAD_RESPONSE %s" % (stamp(), tag, json.dumps(r)[:600]), flush=True)
            return False
        time.sleep(5)
        r = call(req, tag + "-poll")
    print("%s %s_POLL_TIMEOUT" % (stamp(), settle_tag), flush=True)
    return False


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("project")
    ap.add_argument("source_job")
    ap.add_argument("new_job")
    ap.add_argument("--workstream", required=True)
    ap.add_argument("--plan-src", required=True)
    ap.add_argument("--plan-dest", default="refs/plan-63.md")
    ap.add_argument("--machine-id", default=os.environ.get("MACHINE_ID"))
    args = ap.parse_args()

    machine_id = args.machine_id
    if not machine_id:
        with open("/etc/machine-id") as f:
            machine_id = f.read().strip()

    opdir = "%s/%s/%s/mimo-bridge-operations" % (STATE_ROOT, args.project, args.workstream)
    ws = "%s/%s/%s/workspaces/%s" % (WORKSPACES_ROOT, args.project, args.workstream, args.new_job)

    req_path = "%s/%s.create.request.json" % (opdir, args.source_job)
    print("%s SRC_REQUEST %s exists=%s" % (stamp(), req_path, os.path.exists(req_path)), flush=True)
    with open(req_path) as f:
        create_req = dict(json.load(f))
    create_req["jobId"] = args.new_job

    if not poll(create_req, "create", "CREATE_SETTLED_OK", 180):
        print("%s EXIT create-not-ok %s" % (stamp(), args.new_job), flush=True)
        sys.exit(3)

    start_req = {
        "jobId": args.new_job,
        "kind": "MimoProject",
        "machineId": machine_id,
        "operation": "start",
        "projectId": args.project,
        "schemaVersion": 1,
        "workstreamId": args.workstream,
    }
    launched = poll(start_req, "start", "START_SETTLED_OK", 120)

    result_path = "%s/%s.start.result.json" % (opdir, args.new_job)
    try:
        with open(result_path) as f:
            raw = f.read()
    except Exception:
        raw = None
    print("%s START_RESULT_FILE %s %s" % (stamp(), result_path, (raw or "MISSING")[:600]), flush=True)
    file_ok = False
    if raw:
        try:
            file_ok = result_ok(json.loads(raw))
        except Exception:
            file_ok = False

    staged = False
    if launched and file_ok:
        try:
            plan_dest = os.path.join(ws, args.plan_dest)
            os.makedirs(os.path.dirname(plan_dest), exist_ok=True)
            with open(args.plan_src, "rb") as f:
                data = f.read()
            with open(plan_dest, "wb") as f:
                f.write(data)
        except OSError as exc:
            print("%s STAGE_FAILED %s" % (stamp(), exc), flush=True)
        else:
            for root, dirs, files in os.walk(ws):
                for name in files:
                    if name.startswith("._"):
                        try:
                            os.unlink(os.path.join(root, name))
                        except OSError:
                            pass
            staged = True
            print("%s STAGED %s (%d bytes)" % (stamp(), plan_dest, len(data)), flush=True)
    else:
        print("%s NOT_STAGING launched=%s file_ok=%s" % (stamp(), launched, file_ok), flush=True)

    print("%s EXIT launched=%s staged=%s file_ok=%s job=%s" % (stamp(), launched, staged, file_ok, args.new_job), flush=True)
    sys.exit(0 if (launched and staged) else 4)


if __name__ == "__main__":
    main()
