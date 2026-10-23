#!/usr/bin/env python3
"""Passively watch attempt journals and exit when a quota window opens."""

import argparse
import glob
import json
import os
import time

JOURNAL_GLOB = "/srv/worker-state/mimo-projects/*/*/jobs/*/state/attempt-journal/attempt-journal/*.json"


def stamp():
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--hours", type=float, default=12.0)
    ap.add_argument("--glob", default=JOURNAL_GLOB)
    args = ap.parse_args()

    seen = {}
    deadline = time.time() + args.hours * 3600
    print(stamp() + " WATCH_START", flush=True)
    while time.time() < deadline:
        for f in glob.glob(args.glob):
            try:
                st = os.path.getmtime(f)
                with open(f) as fh:
                    d = json.load(fh)
            except Exception:
                continue
            attempts = d.get("attempts") or []
            last = attempts[-1] if attempts else {}
            fd = last.get("failureDetails") or {}
            key = (
                f,
                d.get("updatedAt"),
                last.get("status"),
                d.get("lastFailureReason"),
                fd.get("outputObserved"),
            )
            if seen.get(f) == key:
                continue
            seen[f] = key
            if st < time.time() - 300:
                continue
            print(
                "%s CHANGE job=%s status=%s last=%s reason=%s out=%s"
                % (
                    stamp(),
                    d.get("taskId", "?"),
                    d.get("status", "?"),
                    last.get("status", "-"),
                    d.get("lastFailureReason", "-"),
                    fd.get("outputObserved", "-"),
                ),
                flush=True,
            )
            if fd.get("outputObserved") == "true" or last.get("status") in (
                "completed",
                "succeeded",
                "running",
            ):
                print(
                    stamp() + " WINDOW_OPEN job=" + str(d.get("taskId")),
                    flush=True,
                )
                raise SystemExit(0)
        time.sleep(30)
    print(stamp() + " WATCH_END no-window", flush=True)


if __name__ == "__main__":
    main()
