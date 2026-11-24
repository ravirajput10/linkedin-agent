"""Structured application errors.

Every failure that crosses a layer boundary carries a stable machine-readable
code so the workflow engine, the API and the UI can all reason about it.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any


class ErrorCode(StrEnum):
    AUTHENTICATION_EXPIRED = "AUTHENTICATION_EXPIRED"
    SESSION_EXPIRED = "SESSION_EXPIRED"
    PROFILE_NOT_FOUND = "PROFILE_NOT_FOUND"
    POST_NOT_FOUND = "POST_NOT_FOUND"
    SEARCH_FAILED = "SEARCH_FAILED"
    LIKE_FAILED = "LIKE_FAILED"
    COMMENT_FAILED = "COMMENT_FAILED"
    CONNECTION_FAILED = "CONNECTION_FAILED"
    AI_PROVIDER_ERROR = "AI_PROVIDER_ERROR"
    AI_INVALID_RESPONSE = "AI_INVALID_RESPONSE"
    LLM_CAPABILITY_UNSUPPORTED = "LLM_CAPABILITY_UNSUPPORTED"
    RATE_LIMIT_REACHED = "RATE_LIMIT_REACHED"
    SCHEDULER_ERROR = "SCHEDULER_ERROR"
    CAPABILITY_UNSUPPORTED = "CAPABILITY_UNSUPPORTED"
    PROMPT_NOT_FOUND = "PROMPT_NOT_FOUND"
    PROMPT_VARIABLE_MISSING = "PROMPT_VARIABLE_MISSING"
    INVALID_STATE_TRANSITION = "INVALID_STATE_TRANSITION"
    NOT_FOUND = "NOT_FOUND"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    CONFLICT = "CONFLICT"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"
    EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR"
    PAYMENT_ERROR = "PAYMENT_ERROR"
    QUOTA_EXCEEDED = "QUOTA_EXCEEDED"


#: Errors worth retrying with exponential backoff.
TRANSIENT_ERROR_CODES: frozenset[ErrorCode] = frozenset(
    {
        ErrorCode.AI_PROVIDER_ERROR,
        ErrorCode.SEARCH_FAILED,
        ErrorCode.LIKE_FAILED,
        ErrorCode.COMMENT_FAILED,
        ErrorCode.CONNECTION_FAILED,
        ErrorCode.SCHEDULER_ERROR,
    }
)


class AppError(Exception):
    """Base class for every error raised deliberately by the application."""

    code: ErrorCode = ErrorCode.INTERNAL_ERROR
    http_status: int = 500

    def __init__(
        self,
        message: str,
        *,
        code: ErrorCode | None = None,
        http_status: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if http_status is not None:
            self.http_status = http_status
        self.details = details or {}

    @property
    def is_transient(self) -> bool:
        return self.code in TRANSIENT_ERROR_CODES

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code.value, "message": self.message, "details": self.details}


class NotFoundError(AppError):
    code = ErrorCode.NOT_FOUND
    http_status = 404


class ValidationError(AppError):
    code = ErrorCode.VALIDATION_ERROR
    http_status = 422


class ConflictError(AppError):
    code = ErrorCode.CONFLICT
    http_status = 409


class RateLimitReachedError(AppError):
    code = ErrorCode.RATE_LIMIT_REACHED
    http_status = 429


class InvalidStateTransitionError(AppError):
    code = ErrorCode.INVALID_STATE_TRANSITION
    http_status = 409


class AIProviderError(AppError):
    code = ErrorCode.AI_PROVIDER_ERROR
    http_status = 502


class AIInvalidResponseError(AppError):
    code = ErrorCode.AI_INVALID_RESPONSE
    http_status = 502


class LLMCapabilityUnsupportedError(AppError):
    code = ErrorCode.LLM_CAPABILITY_UNSUPPORTED
    http_status = 501


class PromptNotFoundError(AppError):
    code = ErrorCode.PROMPT_NOT_FOUND
    http_status = 500


class PromptVariableMissingError(AppError):
    code = ErrorCode.PROMPT_VARIABLE_MISSING
    http_status = 500


class PlatformError(AppError):
    """Raised by platform adapters; ``code`` narrows the specific failure."""

    http_status = 502


class CapabilityUnsupportedError(PlatformError):
    """A platform cannot do something. A kind of platform error, so that
    ``except PlatformError`` catches it alongside the rest."""

    code = ErrorCode.CAPABILITY_UNSUPPORTED
    http_status = 501
