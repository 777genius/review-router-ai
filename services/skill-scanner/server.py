"""Private, bounded execution adapter. Product authority and jobs live in ReviewRouter."""
from __future__ import annotations

import ctypes
import hashlib
import hmac
import importlib.metadata
import json
import os
import re
import secrets
import selectors
import signal
import subprocess
import sys
import tempfile
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

import httpx

REVISION = "f3b25697d76256998ca9d42c198d256258d4c035"
VERSION = "2.13.1"
ROOT = Path(__file__).resolve().parent
REPORT_LIMIT = 900_000  # Leave room for the authenticated execution envelope.
ALLOWED_MODEL_HOSTS = {"api.openai.com", "openrouter.ai", "integrate.api.nvidia.com"}


def encoded(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True,
                      allow_nan=False).encode("utf-8")


def digest(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def build_identity() -> str:
    if importlib.metadata.version("skillspector") != VERSION:
        raise RuntimeError("unsupported_scanner_version")
    identity = hashlib.sha256()
    identity.update(sys.version.encode())
    for name in ("server.py", "job.py", "child.py", "egress.py", "Dockerfile", "requirements.lock", "build-requirements.lock"):
        identity.update(name.encode() + b"\0" + (ROOT / name).read_bytes())
    return f"skillspector@{REVISION}:{identity.hexdigest()}"


@dataclass(frozen=True)
class Settings:
    token: str
    scratch: Path
    build: str
    upstream: str = ""
    model: str = ""
    model_key: str = ""
    proxy: str | None = None

    @classmethod
    def from_env(cls) -> Settings:
        token = os.environ.pop("SKILL_SCANNER_TOKEN", "")
        model_key = os.environ.pop("SKILL_SCANNER_LLM_KEY", "")
        if not 32 <= len(token) <= 256 or not token.isascii() or any(ch.isspace() for ch in token):
            raise RuntimeError("scanner_token_required")
        upstream = os.environ.get("SKILL_SCANNER_LLM_URL", "").rstrip("/")
        model = os.environ.get("SKILL_SCANNER_LLM_MODEL", "")
        if any((upstream, model, model_key)):
            parsed = urlsplit(upstream)
            if (not all((upstream, model, model_key)) or len(model_key) > 4096 or
                not model_key.isascii() or any(ch.isspace() for ch in model_key) or parsed.scheme != "https" or
                parsed.hostname not in ALLOWED_MODEL_HOSTS or parsed.port not in (None, 443) or
                parsed.username or parsed.password or parsed.query or parsed.fragment or
                parsed.path not in ("/v1", "/api/v1") or
                not re.fullmatch(r"[A-Za-z0-9_.:/-]{1,128}", model)):
                raise RuntimeError("incomplete_or_unsupported_model_profile")
        proxy = os.environ.get("SKILL_SCANNER_EGRESS_PROXY")
        if proxy != "http://skill-scanner-egress:8082":
            raise RuntimeError("isolated_egress_proxy_required")
        return cls(token, Path("/scan"), build_identity(), upstream, model, model_key, proxy)

    def profiles(self) -> list[dict]:
        result = []
        for mode in (["static", "ai"] if self.upstream else ["static"]):
            ai = mode == "ai"
            endpoint = hashlib.sha256(self.upstream.encode()).hexdigest()[:16] if ai else ""
            profile = {
                "mode": mode, "profileId": f"ai-v1:{endpoint}" if ai else "static-v1",
                "scannerVersion": VERSION, "scannerBuildId": self.build,
                "policyVersion": "skill-import-v1", "model": self.model if ai else None,
                "maxDurationMs": 180000 if ai else 90000, "maxCalls": 4 if ai else 0,
                "maxInputBytes": 131072 if ai else 65536, "maxOutputTokens": 2048 if ai else 0,
            }
            result.append({**profile, "fingerprint": digest(encoded(profile))})
        return result


class BoundedServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8

    def __init__(self, address, handler):
        self.connections = threading.BoundedSemaphore(8)
        super().__init__(address, handler)

    def process_request(self, request, address):
        if not self.connections.acquire(blocking=False):
            request.close()
            return
        request.settimeout(5)
        try:
            super().process_request(request, address)
        except BaseException:
            self.connections.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.connections.release()


class JsonHandler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # No source content, provider output, credentials or request bodies in logs.

    def reply(self, status: int, value: object):
        body = encoded(value)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        if status in (429, 503):
            self.send_header("Retry-After", "5")
        self.end_headers()
        self.close_connection = True
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def body(self, maximum: int) -> dict:
        if self.headers.get("Transfer-Encoding") or len(self.headers.get_all("Content-Length", [])) != 1 or self.headers.get_content_type() != "application/json":
            raise ValueError("invalid_body")
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= maximum:
            raise ValueError("invalid_length")
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise ValueError("truncated_body")

        def unique(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("duplicate_field")
                result[key] = value
            return result

        value = json.loads(raw.decode("utf-8"), object_pairs_hook=unique,
                           parse_constant=lambda _: (_ for _ in ()).throw(ValueError("invalid_number")))
        if not isinstance(value, dict):
            raise ValueError("invalid_body")
        return value

    def authorized(self, token: str) -> bool:
        return not self.headers.get("Origin") and hmac.compare_digest(
            self.headers.get("Authorization", "").encode("utf-8"), ("Bearer " + token).encode("utf-8"))


class ModelBudget:
    """Counts attempted transmissions, including provider errors, before sending."""
    def __init__(self, settings: Settings, profile: dict, deadline: float):
        self.settings, self.profile, self.deadline = settings, profile, deadline
        self.token = secrets.token_urlsafe(32)
        self.calls = 0
        self.lock = threading.Lock()

    def complete(self, payload: dict) -> tuple[int, bytes]:
        allowed = {"model", "messages", "stream", "n", "max_tokens", "max_completion_tokens",
                   "temperature", "top_p", "seed", "tools", "tool_choice", "response_format",
                   "parallel_tool_calls", "reasoning_effort"}
        if set(payload) - allowed or any(tool.get("type") != "function" for tool in payload.get("tools", [])):
            raise ValueError("unsupported_model_option")
        if payload.get("stream") not in (None, False) or payload.get("n", 1) != 1:
            raise ValueError("unsupported_response_mode")
        if not isinstance(payload.get("messages"), list) or not payload["messages"]:
            raise ValueError("messages_required")
        for message in payload["messages"]:
            value = message.get("content")
            if not isinstance(value, str) and not (isinstance(value, list) and all(
                isinstance(part, dict) and part.get("type") == "text" and isinstance(part.get("text"), str)
                for part in value
            )):
                raise ValueError("text_messages_only")
        # Only one fixed provider/model and one response; the child cannot increase bounds.
        payload["model"] = self.settings.model
        payload.pop("max_tokens", None)
        payload["max_completion_tokens"] = self.profile["maxOutputTokens"]
        payload["stream"] = False
        payload["n"] = 1
        raw = encoded(payload)
        if len(raw) > self.profile["maxInputBytes"]:
            raise ValueError("model_input_limit")
        with self.lock:
            remaining = self.deadline - time.monotonic()
            if remaining <= 0 or self.calls >= self.profile["maxCalls"]:
                raise TimeoutError("model_budget_exhausted")
            self.calls += 1
        with httpx.Client(trust_env=False, follow_redirects=False,
                          proxy=self.settings.proxy, timeout=min(45, remaining)) as client:
            with client.stream("POST", self.settings.upstream + "/chat/completions",
                               headers={"Authorization": "Bearer " + self.settings.model_key,
                                        "Content-Type": "application/json"}, content=raw) as response:
                if response.status_code != 200:
                    return 502, b'{"error":{"message":"Analysis provider unavailable"}}'
                chunks, total = [], 0
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > 262144 or time.monotonic() >= self.deadline:
                        raise TimeoutError("model_response_limit")
                    chunks.append(chunk)
                return 200, b"".join(chunks)


@contextmanager
def model_relay(settings: Settings, profile: dict, deadline: float):
    budget = ModelBudget(settings, profile, deadline)

    class Handler(JsonHandler):
        def do_POST(self):
            if not self.authorized(budget.token):
                self.reply(401, {"error": "unauthorized"})
                return
            if self.path != "/v1/chat/completions":
                self.reply(404, {"error": "unsupported_endpoint"})
                return
            try:
                status, raw = budget.complete(self.body(profile["maxInputBytes"]))
                self.reply(status, json.loads(raw))
            except ValueError:
                self.reply(400, {"error": {"message": "Unsupported analysis request"}})
            except TimeoutError:
                self.reply(429, {"error": {"message": "Analysis budget exhausted"}})
            except Exception:
                self.reply(502, {"error": {"message": "Analysis provider unavailable"}})

    server = BoundedServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1", budget
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def enable_child_reaping():
    if sys.platform == "linux" and ctypes.CDLL(None).prctl(36, 1, 0, 0, 0) != 0:
        raise RuntimeError("child_subreaper_required")  # PR_SET_CHILD_SUBREAPER


def terminate(process: subprocess.Popen):
    # A leader exit does not prove that its descendants stopped. Kill the owned
    # group even when wait() already returned, then reap only that group's children.
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        process.wait(timeout=1)
        return
    try:
        process.wait(timeout=.2)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=3)
    until = time.monotonic() + 3
    while True:
        try:
            while os.waitpid(-process.pid, os.WNOHANG)[0]:
                pass
        except ChildProcessError:
            pass
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            return
        if time.monotonic() >= until:
            raise RuntimeError("scanner_group_exit_unconfirmed")
        time.sleep(.01)


def run_child(settings: Settings, profile: dict, content: str, deadline: float,
              directory: Path) -> object:
    if time.monotonic() >= deadline:
        return None
    (directory / "SKILL.md").write_bytes(content.encode("utf-8"))
    environment = {
        "PATH": str(Path(sys.executable).parent) + ":/usr/bin:/bin", "HOME": str(directory),
        "TMPDIR": str(directory), "LANG": "C.UTF-8", "PYTHONDONTWRITEBYTECODE": "1",
        "LANGCHAIN_TRACING_V2": "false", "LANGSMITH_TRACING": "false",
        "SKILLSPECTOR_PROVIDER": "openai_compatible", "SKILLSPECTOR_LOG_LEVEL": "ERROR",
        "SKILLSPECTOR_MAX_WORKFLOW_SECONDS": str(max(0.1, deadline - time.monotonic())),
        "SKILLSPECTOR_MAX_STATIC_ANALYSIS_SECONDS_PER_ARTIFACT": "30",
        "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1", "NO_PROXY": "127.0.0.1,localhost",
    }
    if settings.proxy:
        environment.update({"HTTPS_PROXY": settings.proxy, "HTTP_PROXY": settings.proxy})
    environment["TIKTOKEN_CACHE_DIR"] = str(Path(sys.prefix) / "share" / "tiktoken")
    command = [sys.executable, "-I", str(ROOT / "job.py"), str(directory), profile["mode"], str(os.getpid())]
    if time.monotonic() >= deadline:
        return None
    process = subprocess.Popen(command, cwd=directory, env=environment, start_new_session=True,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    # Only the trusted supervisor receives the scoped model key, over a private
    # pipe. The scanner's stdin/environment never contains it or the service token.
    assert process.stdin
    selector = selectors.DefaultSelector()
    assert process.stdout and process.stderr
    emitted = 0
    confirmed = False
    try:
        selector.register(process.stdout, selectors.EVENT_READ)
        selector.register(process.stderr, selectors.EVENT_READ)
        process.stdin.write(encoded({"upstream": settings.upstream, "model": settings.model,
            "modelKey": settings.model_key, "proxy": settings.proxy, "build": settings.build,
            "profile": profile, "deadline": deadline}))
        process.stdin.close()
        while selector.get_map():
            if time.monotonic() >= deadline:
                raise TimeoutError("scanner_deadline")
            for key, _ in selector.select(timeout=min(.2, max(.01, deadline - time.monotonic()))):
                chunk = os.read(key.fileobj.fileno(), 8192)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                emitted += len(chunk)
                if emitted > 65536:
                    raise ValueError("scanner_log_limit")
        process.wait(timeout=max(.01, deadline - time.monotonic()))
        terminate(process)
        confirmed = True
        report_path = directory / "report.json"
        if process.returncode not in (0, 1) or not report_path.is_file() or report_path.stat().st_size > REPORT_LIMIT:
            return None
        report = json.loads(report_path.read_text("utf-8"))
        # The native report is normalized by the application, never trusted here as a verdict.
        return report if isinstance(report, dict) else None
    except (TimeoutError, ValueError, OSError, subprocess.TimeoutExpired):
        return None
    finally:
        try:
            if not confirmed:
                terminate(process)
        finally:
            selector.close()
            process.stdout.close()
            process.stderr.close()
            process.stdin.close()


def execute(settings: Settings, profile: dict, content: str, deadline: float) -> object:
    deadline = min(deadline, time.monotonic() + profile["maxDurationMs"] / 1000)
    if time.monotonic() >= deadline:
        return None
    enable_child_reaping()
    with tempfile.TemporaryDirectory(prefix="scan-", dir=settings.scratch) as name:
        return run_child(settings, profile, content, deadline, Path(name))


def make_server(settings: Settings, address=("0.0.0.0", 8081)) -> BoundedServer:
    profiles = {p["mode"]: p for p in settings.profiles()}
    active = threading.Lock()
    unconfirmed = threading.Event()
    attempts: dict[str, float] = {}
    attempts_lock = threading.Lock()

    class Handler(JsonHandler):
        def do_GET(self):
            if not self.authorized(settings.token):
                self.reply(401, {"error": "unauthorized"})
            elif unconfirmed.is_set():
                self.reply(503, {"error": "execution_unconfirmed"})
            elif self.path == "/v1/profiles":
                self.reply(200, {"schemaVersion": 1, "profiles": list(profiles.values())})
            else:
                self.reply(404, {"error": "not_found"})

        def do_POST(self):
            if not self.authorized(settings.token):
                self.reply(401, {"error": "unauthorized"})
                return
            if self.path != "/v1/scans":
                self.reply(404, {"error": "not_found"})
                return
            try:
                request = self.body(524288)
                if set(request) != {"jobId", "attemptId", "profile", "content", "contentDigest", "profileFingerprint", "deadlineAt"}:
                    raise ValueError("invalid_fields")
                for key in ("jobId", "attemptId"):
                    if not isinstance(request[key], str) or not re.fullmatch(r"[A-Za-z0-9:_-]{1,160}", request[key]):
                        raise ValueError("invalid_identity")
                selected = profiles.get(request["profile"])
                content = request["content"]
                if (not selected or request["profileFingerprint"] != selected["fingerprint"] or
                    not isinstance(content, str) or not content.strip() or "\0" in content or
                    len(content.encode("utf-8")) > 65536 or request["contentDigest"] != digest(content.encode("utf-8"))):
                    raise ValueError("invalid_candidate")
                deadline = datetime.fromisoformat(request["deadlineAt"].replace("Z", "+00:00"))
                if deadline.tzinfo is None:
                    raise ValueError("invalid_deadline")
                remaining = deadline.timestamp() - time.time()
                if remaining <= 0 or remaining > selected["maxDurationMs"] / 1000 + 5:
                    raise ValueError("expired_deadline")
                # Admission and scheduling consume the same execution budget.
                deadline_monotonic = time.monotonic() + min(remaining, selected["maxDurationMs"] / 1000)
            except (ValueError, TypeError, KeyError, AttributeError, UnicodeError, OSError):
                self.reply(400, {"error": "invalid_request"})
                return
            with attempts_lock:
                now = time.monotonic()
                for key in [key for key, expiry in attempts.items() if expiry <= now]:
                    del attempts[key]
                if request["attemptId"] in attempts:
                    self.reply(409, {"error": "attempt_already_submitted"})
                    return
                if len(attempts) >= 1024 or not active.acquire(blocking=False):
                    self.reply(503, {"error": "busy"})
                    return
                attempts[request["attemptId"]] = now + 600
            try:
                report = execute(settings, selected, content, deadline_monotonic)
            except Exception:
                # Keep the permit poisoned until the container is restarted. A
                # timeout in the caller cannot prove that this process group died.
                unconfirmed.set()
                self.reply(503, {"error": "execution_unconfirmed"})
                return
            try:
                self.reply(200, {"schemaVersion": 1, "jobId": request["jobId"],
                    "attemptId": request["attemptId"], "contentDigest": request["contentDigest"],
                    "profileFingerprint": selected["fingerprint"], "scannerBuildId": settings.build,
                    "executionFinished": True, "report": report})
            finally:
                active.release()

    return BoundedServer(address, Handler)


def verify_runtime_envelope(scratch: Path):
    if sys.platform != "linux" or os.geteuid() == 0:
        raise RuntimeError("unprivileged_linux_container_required")
    mounts = Path("/proc/self/mountinfo").read_text().splitlines()
    root_mount = next(line.split() for line in mounts if line.split()[4] == "/")
    status = dict(line.split(":", 1) for line in Path("/proc/self/status").read_text().splitlines())
    if "ro" not in root_mount[5].split(",") or int(status["CapEff"].strip(), 16) != 0 or status["NoNewPrivs"].strip() != "1":
        raise RuntimeError("readonly_unprivileged_runtime_required")
    mount = next((line.split(" - ")[1].split()[0] for line in mounts
                  if line.split()[4] == str(scratch)), None)
    space = os.statvfs(scratch)
    if mount != "tmpfs" or space.f_frsize * space.f_blocks > 32 * 1024 * 1024:
        raise RuntimeError("bounded_private_tmpfs_required")
    for file, maximum in (("memory.max", 1024 ** 3), ("pids.max", 64)):
        value = Path("/sys/fs/cgroup", file).read_text().strip()
        if value == "max" or int(value) > maximum:
            raise RuntimeError("bounded_cgroup_required")
    # Prevent a compromised child from inspecting the parent capability/model credentials.
    if ctypes.CDLL(None).prctl(4, 0, 0, 0, 0) != 0:  # PR_SET_DUMPABLE
        raise RuntimeError("process_credential_isolation_failed")


def main():
    settings = Settings.from_env()
    verify_runtime_envelope(settings.scratch)
    server = make_server(settings)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
