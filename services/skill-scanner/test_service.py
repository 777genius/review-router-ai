"""Loopback-only E2E launcher; real scanner, not production container qualification."""
import argparse
import os
from contextlib import nullcontext
from pathlib import Path

from model_fixture import loopback_model
from server import Settings, build_identity, make_server


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["serve"])
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--with-loopback-ai", action="store_true")
    args = parser.parse_args()
    args.scratch.mkdir(parents=True, exist_ok=True, mode=0o700)
    token = os.environ.get("SKILL_SCANNER_TOKEN", "")
    if len(token) < 32:
        raise SystemExit("fixture_scanner_token_required")
    # Test launcher deliberately does not assert cgroup/container isolation.
    # Optional AI is confined to this process's fake loopback provider. Ambient
    # provider credentials and destinations are never read or forwarded.
    with loopback_model() if args.with_loopback_ai else nullcontext(None) as fixture:
        model = (fixture[0] + "/v1", "fixture-model", "fixture-model-key") if fixture else ()
        settings = Settings(token, args.scratch, build_identity(), *model)
        make_server(settings, ("127.0.0.1", args.port)).serve_forever()


if __name__ == "__main__":
    main()
