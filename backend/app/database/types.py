"""Shared column types and declarative mixins."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from sqlalchemy import Enum as SAEnum
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column


def enum_column(enum_cls: type[Enum], **kwargs: Any) -> SAEnum:
    """Store an enum as a constrained VARCHAR rather than a native PG type.

    Native PG enums require a migration for every new member, which is a poor
    fit for a state machine that keeps growing.
    """
    return SAEnum(
        enum_cls,
        native_enum=False,
        length=64,
        validate_strings=True,
        values_callable=lambda cls: [member.value for member in cls],
        **kwargs,
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), nullable=False, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )


JSONBDict = JSONB
