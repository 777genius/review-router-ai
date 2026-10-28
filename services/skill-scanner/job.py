"""One killable process group owns both the model relay and the scanner."""
import ctypes
import json
import os
import signal
import subprocess
import sys
from pathlib import Path

# -I deliberately excludes ambient module paths; add only the read-only service.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from server import ROOT, Settings, model_relay  # noqa: E402

directory, mode, expected_parent = Path(sys.argv[1]), sys.argv[2], int(sys.argv[3])
if sys.platform == "linux":
    libc = ctypes.CDLL(None)
    if libc.prctl(1, signal.SIGKILL, 0, 0, 0) or libc.prctl(4, 0, 0, 0, 0):
        raise SystemExit(2)
    if os.getppid() != expected_parent:
        raise SystemExit(2)
configuration = json.loads(sys.stdin.buffer.read(16384))
settings = Settings("", directory, configuration["build"], configuration["upstream"],
                    configuration["model"], configuration["modelKey"], configuration["proxy"])
profile = configuration["profile"]
environment = dict(os.environ)


def scan():
    # Inherit this supervisor's group. The outer service can terminate relay and
    # CLI descendants together, including after this group's leader has exited.
    return subprocess.run([sys.executable, "-I", str(ROOT / "child.py"), str(directory),
                           mode, str(os.getpid())], env=environment, stdin=subprocess.DEVNULL,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False).returncode


if mode == "ai":
    with model_relay(settings, profile, configuration["deadline"]) as (url, budget):
        environment.update({"SKILLSPECTOR_COMPAT_BASE_URL": url,
                            "SKILLSPECTOR_COMPAT_API_KEY": budget.token,
                            "SKILLSPECTOR_MODEL": settings.model})
        result = scan()
else:
    result = scan()
# Process exit closes every relay socket/thread. The outer supervisor confirms
# group termination before publishing executionFinished or freeing capacity.
raise SystemExit(result)
