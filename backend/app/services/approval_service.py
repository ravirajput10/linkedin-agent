"""Approval Center: list pending decisions, and record approve / reject / edit / regenerate."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai.agents import CommentGeneratorAgent, ConnectionGeneratorAgent
from app.database.models import (
    Approval,
    Campaign,
    Comment,
    ConnectionMessage,
    Person,
    Post,
    PostEvaluation,
    Workflow,
)
from app.enums import ApprovalStatus, ApprovalType, EventType, LogLevel
from app.errors import ConflictError, NotFoundError, ValidationError
from app.logging import get_logger
from app.services import events, scoping

logger = get_logger(__name__)


def get_approval(
    session: Session, approval_id: int, *, owner_id: int | None = None
) -> Approval:
    approval = session.scalar(
        scoping.restrict(
            select(Approval).where(Approval.id == approval_id),
            Approval.campaign_id,
            owner_id,
        )
    )
    if approval is None:
        raise NotFoundError(f"Approval {approval_id} not found.")
    return approval


def list_approvals(
    session: Session,
    *,
    approval_type: ApprovalType | None = None,
    status: ApprovalStatus | None = ApprovalStatus.PENDING,
    campaign_id: int | None = None,
    owner_id: int | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[Approval], int]:
    stmt = scoping.restrict(select(Approval), Approval.campaign_id, owner_id)
    count_stmt = scoping.restrict(
        select(func.count()).select_from(Approval), Approval.campaign_id, owner_id
    )

    conditions = []
    if approval_type is not None:
        conditions.append(Approval.approval_type == approval_type)
    if status is not None:
        conditions.append(Approval.status == status)
    if campaign_id is not None:
        conditions.append(Approval.campaign_id == campaign_id)
    for condition in conditions:
        stmt = stmt.where(condition)
        count_stmt = count_stmt.where(condition)

    total = session.scalar(count_stmt) or 0
    items = list(
        session.scalars(stmt.order_by(Approval.created_at.desc()).offset(offset).limit(limit))
    )
    return items, total


def counts_by_type(session: Session, *, owner_id: int | None = None) -> dict[str, int]:
    rows = session.execute(
        scoping.restrict(
            select(Approval.approval_type, func.count()).where(
                Approval.status == ApprovalStatus.PENDING
            ),
            Approval.campaign_id,
            owner_id,
        ).group_by(Approval.approval_type)
    )
    return {approval_type.value: count for approval_type, count in rows}


def _subject(session: Session, approval: Approval) -> Comment | ConnectionMessage | None:
    if approval.comment_id:
        return session.get(Comment, approval.comment_id)
    if approval.connection_message_id:
        return session.get(ConnectionMessage, approval.connection_message_id)
    return None


def approve(
    session: Session,
    approval_id: int,
    *,
    edited_content: str | None = None,
    note: str | None = None,
    decided_by: str | None = None,
    owner_id: int | None = None,
) -> Approval:
    """Approve a pending decision, optionally replacing the generated text."""
    approval = get_approval(session, approval_id, owner_id=owner_id)
    if approval.status is not ApprovalStatus.PENDING:
        raise ConflictError(f"Approval {approval_id} is already {approval.status.value}.")

    if edited_content is not None:
        edited = edited_content.strip()
        if not edited:
            raise ValidationError("Edited content cannot be empty.")
        subject = _subject(session, approval)
        if isinstance(subject, ConnectionMessage) and len(edited) > 300:
            raise ValidationError(
                "A connection note cannot exceed 300 characters.",
                details={"length": len(edited)},
            )
        if subject is not None:
            subject.edited_text = edited
        approval.content = edited

    approval.status = ApprovalStatus.APPROVED
    approval.decided_at = datetime.now(UTC)
    approval.decided_by = decided_by
    approval.decision_note = note
    session.flush()

    events.emit(
        session,
        EventType.AGENT_LOG,
        f"{approval.approval_type.value.title()} approved for approval #{approval.id}.",
        campaign_id=approval.campaign_id,
        person_id=approval.person_id,
        workflow_id=approval.workflow_id,
        payload={"approval_id": approval.id, "edited": edited_content is not None},
    )
    return approval


def reject(
    session: Session,
    approval_id: int,
    *,
    note: str | None = None,
    decided_by: str | None = None,
    owner_id: int | None = None,
) -> Approval:
    approval = get_approval(session, approval_id, owner_id=owner_id)
    if approval.status is not ApprovalStatus.PENDING:
        raise ConflictError(f"Approval {approval_id} is already {approval.status.value}.")

    approval.status = ApprovalStatus.REJECTED
    approval.decided_at = datetime.now(UTC)
    approval.decided_by = decided_by
    approval.decision_note = note
    session.flush()

    events.emit(
        session,
        EventType.AGENT_LOG,
        f"{approval.approval_type.value.title()} rejected for approval #{approval.id}.",
        campaign_id=approval.campaign_id,
        person_id=approval.person_id,
        workflow_id=approval.workflow_id,
        level=LogLevel.WARNING,
        payload={"approval_id": approval.id, "note": note},
    )
    return approval


async def regenerate(
    session: Session,
    approval_id: int,
    *,
    feedback: str | None = None,
    owner_id: int | None = None,
) -> Approval:
    """Ask the generator for a fresh draft, keeping the approval pending."""
    approval = get_approval(session, approval_id, owner_id=owner_id)
    if approval.status is not ApprovalStatus.PENDING:
        raise ConflictError("Only a pending approval can be regenerated.")

    campaign = session.get(Campaign, approval.campaign_id)
    person = session.get(Person, approval.person_id)
    workflow = session.get(Workflow, approval.workflow_id) if approval.workflow_id else None
    if campaign is None or person is None:
        raise NotFoundError("Campaign or person for this approval is missing.")

    match approval.approval_type:
        case ApprovalType.COMMENT:
            comment = session.get(Comment, approval.comment_id) if approval.comment_id else None
            if comment is None:
                raise NotFoundError("Comment draft is missing.")
            post = session.get(Post, comment.post_id)
            if post is None:
                raise NotFoundError("Post for this comment is missing.")

            evaluation = session.scalar(
                select(PostEvaluation)
                .where(PostEvaluation.post_id == post.id)
                .order_by(PostEvaluation.id.desc())
            )
            result = await CommentGeneratorAgent().run(
                session=session,
                campaign_id=campaign.id,
                person_id=person.id,
                workflow_id=workflow.id if workflow else None,
                post=post,
                person=person,
                campaign=campaign,
                evaluation=evaluation,
                regeneration_feedback=feedback,
            )
            comment.generated_text = result.data.comment
            comment.edited_text = None
            comment.regeneration_count += 1
            for field, value in result.audit_fields.items():
                setattr(comment, field, value)
            comment.raw_output = result.data.model_dump(mode="json", by_alias=True)
            approval.content = result.data.comment

        case ApprovalType.CONNECTION:
            message = (
                session.get(ConnectionMessage, approval.connection_message_id)
                if approval.connection_message_id
                else None
            )
            if message is None:
                raise NotFoundError("Connection message draft is missing.")

            reference_post = None
            if workflow is not None:
                post_id = workflow.context.get("evaluated_post_id")
                reference_post = session.get(Post, post_id) if post_id else None

            result = await ConnectionGeneratorAgent().run(
                session=session,
                campaign_id=campaign.id,
                person_id=person.id,
                workflow_id=workflow.id if workflow else None,
                person=person,
                campaign=campaign,
                reference_post=reference_post,
                regeneration_feedback=feedback,
            )
            message.generated_text = result.data.message
            message.edited_text = None
            message.regeneration_count += 1
            for field, value in result.audit_fields.items():
                setattr(message, field, value)
            message.raw_output = result.data.model_dump(mode="json", by_alias=True)
            approval.content = result.data.message

        case ApprovalType.CANDIDATE:
            raise ValidationError("A candidate approval has no generated content to regenerate.")

    session.flush()
    events.emit(
        session,
        EventType.AGENT_LOG,
        f"Regenerated content for approval #{approval.id}.",
        campaign_id=approval.campaign_id,
        person_id=approval.person_id,
        workflow_id=approval.workflow_id,
        payload={"approval_id": approval.id, "feedback": feedback},
    )
    return approval


def skip_person(
    session: Session,
    approval_id: int,
    *,
    note: str | None = None,
    decided_by: str | None = None,
    owner_id: int | None = None,
) -> Approval:
    """FR-6.6: Reject current approval and skip the person from further sequence actions."""
    approval = get_approval(session, approval_id, owner_id=owner_id)
    if approval.status is not ApprovalStatus.PENDING:
        raise ConflictError(f"Approval {approval_id} is already {approval.status.value}.")

    approval.status = ApprovalStatus.REJECTED
    approval.decided_at = datetime.now(UTC)
    approval.decided_by = decided_by
    approval.decision_note = note or "Skipped person from approval queue"

    # Also skip this person in the campaign if present
    try:
        from app.services.campaign_service import skip_prospect

        skip_prospect(session, approval.campaign_id, approval.person_id, owner_id=owner_id)
    except Exception as exc:
        logger.warning(
            "Could not skip prospect #%s in campaign #%s: %s",
            approval.person_id,
            approval.campaign_id,
            exc,
        )

    session.flush()
    events.emit(
        session,
        EventType.AGENT_LOG,
        f"Skipped prospect #{approval.person_id} via approval #{approval.id}.",
        campaign_id=approval.campaign_id,
        person_id=approval.person_id,
        workflow_id=approval.workflow_id,
        level=LogLevel.WARNING,
        payload={"approval_id": approval.id, "note": note},
    )
    return approval


def bulk_approve(
    session: Session,
    *,
    approval_type: ApprovalType | None = None,
    approval_ids: list[int] | None = None,
    decided_by: str | None = None,
    owner_id: int | None = None,
) -> list[Approval]:
    """FR-6.7: Bulk approve pending approvals."""
    stmt = scoping.restrict(
        select(Approval).where(Approval.status == ApprovalStatus.PENDING),
        Approval.campaign_id,
        owner_id,
    )
    if approval_type is not None:
        stmt = stmt.where(Approval.approval_type == approval_type)
    if approval_ids is not None:
        stmt = stmt.where(Approval.id.in_(approval_ids))

    approvals = list(session.scalars(stmt))
    now = datetime.now(UTC)
    for app in approvals:
        app.status = ApprovalStatus.APPROVED
        app.decided_at = now
        app.decided_by = decided_by
        app.decision_note = "Bulk approved"
        events.emit(
            session,
            EventType.AGENT_LOG,
            f"{app.approval_type.value.title()} bulk approved for approval #{app.id}.",
            campaign_id=app.campaign_id,
            person_id=app.person_id,
            workflow_id=app.workflow_id,
            payload={"approval_id": app.id, "bulk": True},
        )
    session.flush()
    return approvals


def expire_stale_approvals(
    session: Session,
    *,
    older_than_hours: int = 48,
    owner_id: int | None = None,
) -> list[Approval]:
    """FR-6.9: Expire pending approvals older than N hours (default 48h)."""
    cutoff = datetime.now(UTC) - timedelta(hours=older_than_hours)
    stmt = scoping.restrict(
        select(Approval).where(
            Approval.status == ApprovalStatus.PENDING,
            Approval.created_at <= cutoff,
        ),
        Approval.campaign_id,
        owner_id,
    )
    stale = list(session.scalars(stmt))
    now = datetime.now(UTC)
    for app in stale:
        app.status = ApprovalStatus.CANCELLED
        app.decided_at = now
        app.decision_note = f"Expired after {older_than_hours}h awaiting approval"
        events.emit(
            session,
            EventType.AGENT_LOG,
            f"Approval #{app.id} expired after {older_than_hours}h without human approval.",
            campaign_id=app.campaign_id,
            person_id=app.person_id,
            workflow_id=app.workflow_id,
            level=LogLevel.WARNING,
            payload={"approval_id": app.id, "expired": True},
        )
    session.flush()
    return stale
