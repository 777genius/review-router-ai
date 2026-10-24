"""Bounded diagnostic-sink hardening for the pinned Hindsight deployment.

No exception is wrapped or mutated: native retry classification sees the original.
Diagnostic messages are deliberately metadata-only, rather than regex-redacted.
"""

import json
import logging
import sys
import threading


def safe_error(error: BaseException) -> str:
    return type(error).__name__


def install() -> None:
    """Run before native configuration/provider imports, including spawned workers."""
    if getattr(logging, "_router_privacy_installed", False):
        return
    logging._router_privacy_installed = True
    original = logging.Logger.makeRecord
    standard_fields = frozenset(logging.LogRecord("", 0, "", 0, "", (), None).__dict__)

    def make_record(self, *args, **kwargs):
        record = original(self, *args, **kwargs)
        error_type = safe_error(record.exc_info[1]) if record.exc_info and record.exc_info[1] else "none"
        for field in tuple(record.__dict__):
            if field not in standard_fields:
                del record.__dict__[field]
        record.msg = "native_event=%s:%d exception_class=%s"
        record.args = (record.module, record.lineno, error_type)
        record.exc_info = None
        record.exc_text = None
        record.stack_info = None
        return record

    logging.Logger.makeRecord = make_record
    logging.captureWarnings(True)

    def uncaught(error_type, error, traceback):
        # Do not call the original hook: exception messages and source lines can
        # carry bodies/credentials. Exit semantics remain Python's responsibility.
        sys.stderr.write(json.dumps({"event": "uncaught_exception", "exception_class": safe_error(error)}) + "\n")

    sys.excepthook = uncaught
    threading.excepthook = lambda args: uncaught(args.exc_type, args.exc_value, args.exc_traceback)


def install_http(app) -> None:
    """Preserve protocol status/retry headers while removing error-body echoes."""
    from fastapi.exceptions import RequestValidationError
    from fastapi.responses import JSONResponse
    from starlette.exceptions import HTTPException
    from hindsight_api.extensions.tenant import AuthenticationError
    from hindsight_api.engine.memories.base import StoreWriteUnavailable

    async def http_error(request, error):
        headers = {}
        # Native StoreWriteUnavailable uses this header for backpressure.
        retry_after = (error.headers or {}).get("Retry-After")
        if retry_after is not None:
            try:
                headers["Retry-After"] = str(max(0, min(86400, int(retry_after))))
            except (TypeError, ValueError):
                pass
        return JSONResponse(status_code=error.status_code, content={"detail": "native_request_failed"}, headers=headers)

    async def validation_error(request, error):
        return JSONResponse(status_code=422, content={"detail": "native_request_invalid"})

    async def unexpected_error(request, error):
        logging.getLogger(__name__).error("native_request_failed", exc_info=error)
        return JSONResponse(status_code=500, content={"detail": "native_request_failed"})

    async def authentication_error(request, error):
        return JSONResponse(status_code=401, content={"detail": "native_authentication_failed"})

    async def store_unavailable(request, error):
        return await http_error(request, HTTPException(status_code=503, detail="native_unavailable", headers={"Retry-After": str(getattr(error, "retry_after", 30))}))

    app.add_exception_handler(HTTPException, http_error)
    app.add_exception_handler(RequestValidationError, validation_error)
    app.add_exception_handler(Exception, unexpected_error)
    app.add_exception_handler(AuthenticationError, authentication_error)
    app.add_exception_handler(StoreWriteUnavailable, store_unavailable)
