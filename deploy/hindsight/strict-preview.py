"""Dry-run-only execution control. No semantic extraction algorithm lives here."""
from contextvars import ContextVar

_active = ContextVar("hindsight_strict_preview", default=False)


def active():
    return _active.get()


async def run(enabled, extraction, *args, **kwargs):
    if not enabled:
        return await extraction(*args, **kwargs)
    from fastapi.responses import JSONResponse

    token = _active.set(True)
    try:
        result = await extraction(*args, **kwargs)
        # One complete extraction chunk, including true completed abstention.
        if len(result.chunks) != 1 or len(result.facts) > 4:
            raise ValueError("strict_preview_incomplete")
        return JSONResponse(
            content=result.model_dump(mode="json"),
            headers={"X-Hindsight-Strict-Preview": "v1"},
        )
    finally:
        _active.reset(token)
