"""Fixed scanner entrypoint; no command, path or option supplied by a product user."""
import ctypes
import os
import resource
import signal
import sys
from pathlib import Path

directory, mode = Path(sys.argv[1]), sys.argv[2]
if sys.platform == "linux":
    if ctypes.CDLL(None).prctl(1, signal.SIGKILL, 0, 0, 0) != 0:
        raise SystemExit(2)
    if os.getppid() != int(sys.argv[3]):
        raise SystemExit(2)
if mode not in ("static", "ai"):
    raise SystemExit(2)
resource.setrlimit(resource.RLIMIT_FSIZE, (2 * 1024 * 1024, 2 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
resource.setrlimit(resource.RLIMIT_CPU, (190, 190))
sys.argv = ["skillspector", "scan", str(directory / "SKILL.md"), "--format", "json",
            "--output", str(directory / "report.json"), "--fail-on-incomplete"]
if mode == "static":
    sys.argv.append("--no-llm")

from skillspector.cli import app  # noqa: E402

app()
