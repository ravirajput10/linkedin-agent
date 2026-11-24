"""FastAPI application entry point. """

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import api_router
from app.config import settings
from app.errors import AppError, ErrorCode
from app.logging import configure_logging, get_logger

configure_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "Starting %s (env=%s, dry_run=%s, llm=%s, platform=%s)",
        settings.app_name,
        settings.app_env.value,
        settings.dry_run,
        settings.llm_provider.value,
        settings.platform_adapter.value,
    )

    # Seed the first administrator when the users table is empty, so a fresh
    # deployment is reachable without a shell. A database that is not up yet is
    # not fatal here: the request handlers will surface it with a real error.
    try:
        from app.database import SessionLocal
        from app.services.user_service import ensure_bootstrap_admin

        with SessionLocal() as session:
            ensure_bootstrap_admin(session)
    except Exception:
        logger.warning("Could not run the admin bootstrap check", exc_info=True)

    yield
    from app.ai.provider_factory import get_llm_provider
    from app.integrations.platform.factory import (
        close_account_adapters,
        get_platform_adapter,
    )

    try:
        await get_llm_provider().aclose()
        await get_platform_adapter().aclose()
        await close_account_adapters()
    except Exception:
        logger.debug("Error while closing providers", exc_info=True)


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description=(
        "AI-powered engagement and networking agent. The workflow engine owns "
        "control flow; the LLM supplies reasoning only."
    ),
    lifespan=lifespan,
    docs_url="/docs",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=r"^chrome-extension://.*$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    logger.warning("%s %s -> %s: %s", request.method, request.url.path, exc.code, exc.message)
    return JSONResponse(status_code=exc.http_status, content=exc.to_dict())


def _serializable_errors(errors: list[dict]) -> list[dict]:
    """Strip values that cannot be JSON-encoded out of a validation error.

    Pydantic puts the raised exception object itself in ``ctx["error"]`` for a
    custom field validator. Passing that straight to ``JSONResponse`` raises
    while rendering the 422, turning a clear "password too short" into an
    opaque 500.
    """
    cleaned = []
    for error in errors:
        item = {key: value for key, value in error.items() if key != "ctx"}
        ctx = error.get("ctx")
        if isinstance(ctx, dict):
            item["ctx"] = {
                key: value if isinstance(value, (str, int, float, bool, type(None))) else str(value)
                for key, value in ctx.items()
            }
        cleaned.append(item)
    return cleaned


@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "code": ErrorCode.VALIDATION_ERROR.value,
            "message": "Request validation failed.",
            "details": {"errors": _serializable_errors(exc.errors())},
        },
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "code": ErrorCode.INTERNAL_ERROR.value,
            "message": "An unexpected error occurred.",
            "details": {},
        },
    )


@app.get("/health", tags=["system"])
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "app_env": settings.app_env.value,
        "dry_run": settings.dry_run,
        "llm_provider": settings.llm_provider.value,
        "platform_adapter": settings.platform_adapter.value,
    }


app.include_router(api_router, prefix=settings.api_prefix)
