from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database.models import Plan, User
from app.errors import ConflictError, NotFoundError
from app.logging import get_logger
from app.schemas.plan import PlanCreate, PlanUpdate

logger = get_logger(__name__)


def list_active_plans(session: Session) -> list[Plan]:
    """Public: returns all active published plans ordered by sort_order."""
    stmt = (
        select(Plan)
        .where(Plan.is_active.is_(True))
        .order_by(Plan.sort_order.asc(), Plan.created_at.asc())
    )
    return list(session.scalars(stmt).all())


def list_all_plans_with_counts(session: Session) -> list[dict]:
    """Admin: returns all plans with count of subscribed users."""
    plans = list(
        session.scalars(
            select(Plan).order_by(Plan.sort_order.asc(), Plan.created_at.asc())
        ).all()
    )

    # Count users per plan_id
    counts_stmt = select(User.plan_id, func.count(User.id)).group_by(User.plan_id)
    counts_map = dict(session.execute(counts_stmt).all())

    results = []
    for plan in plans:
        results.append(
            {
                "plan": plan,
                "subscriber_count": counts_map.get(plan.id, 0),
            }
        )
    return results


def get_plan(session: Session, plan_id: str) -> Plan:
    plan = session.get(Plan, plan_id)
    if plan is None:
        raise NotFoundError(f"Plan '{plan_id}' does not exist.")
    return plan


def create_plan(session: Session, payload: PlanCreate) -> Plan:
    plan_id = payload.id.strip().lower()
    existing = session.get(Plan, plan_id)
    if existing is not None:
        raise ConflictError(f"A plan with ID '{plan_id}' already exists.")

    plan = Plan(
        id=plan_id,
        name=payload.name.strip(),
        description=payload.description.strip(),
        badge=payload.badge.strip() if payload.badge else None,
        monthly_price=payload.monthly_price,
        annual_price=payload.annual_price,
        currency=payload.currency.strip().upper(),
        trial_days=payload.trial_days,
        is_recommended=payload.is_recommended,
        is_active=payload.is_active,
        sort_order=payload.sort_order,
        button_label=payload.button_label.strip(),
        max_campaigns=payload.max_campaigns,
        monthly_ai_prospects=payload.monthly_ai_prospects,
        daily_action_limit=payload.daily_action_limit,
        has_smart_pacing=payload.has_smart_pacing,
        has_2fa_proxy=payload.has_2fa_proxy,
        has_custom_ai_prompts=payload.has_custom_ai_prompts,
        features=[f.strip() for f in payload.features if f.strip()],
    )

    # If this plan is marked recommended, unset other plans
    if plan.is_recommended:
        _unset_other_recommended(session, plan.id)

    session.add(plan)
    session.flush()
    logger.info("Admin created new plan '%s' (%s)", plan.name, plan.id)
    return plan


def update_plan(session: Session, plan_id: str, payload: PlanUpdate) -> Plan:
    plan = get_plan(session, plan_id)
    data = payload.model_dump(exclude_unset=True)

    if "features" in data and data["features"] is not None:
        data["features"] = [f.strip() for f in data["features"] if f.strip()]

    if data.get("is_recommended"):
        _unset_other_recommended(session, plan.id)

    for key, value in data.items():
        setattr(plan, key, value)

    session.flush()
    logger.info("Admin updated plan '%s'", plan.id)
    return plan


def toggle_active(session: Session, plan_id: str) -> Plan:
    plan = get_plan(session, plan_id)
    plan.is_active = not plan.is_active
    session.flush()
    logger.info("Admin toggled plan '%s' active to %s", plan.id, plan.is_active)
    return plan


def reorder_plans(session: Session, plan_ids: list[str]) -> list[dict]:
    """Admin: updates sort_order for plans according to the provided list sequence (1-indexed)."""
    for index, pid in enumerate(plan_ids, start=1):
        plan = session.get(Plan, pid)
        if plan:
            plan.sort_order = index
    session.flush()
    logger.info("Admin reordered plans: %s", plan_ids)
    return list_all_plans_with_counts(session)


def delete_plan(session: Session, plan_id: str) -> None:
    plan = get_plan(session, plan_id)

    # Check if users are subscribed to this plan
    subscribers = session.scalar(
        select(func.count(User.id)).where(User.plan_id == plan_id)
    ) or 0
    if subscribers > 0:
        raise ConflictError(
            f"Cannot delete plan '{plan.name}' because {subscribers} user(s) are currently subscribed to it. Deactivate the plan instead."
        )

    session.delete(plan)
    session.flush()
    logger.info("Admin deleted plan '%s'", plan_id)


def assign_user_plan(
    session: Session, user_id: int, plan_id: str, billing_cycle: str | None = None
) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise NotFoundError(f"User {user_id} not found.")

    plan = get_plan(session, plan_id)
    user.plan_id = plan.id
    if billing_cycle:
        user.billing_cycle = billing_cycle.strip().lower()

    session.flush()
    logger.info("Assigned plan '%s' to user %s (%s)", plan.id, user.email, user.id)
    return user


def _unset_other_recommended(session: Session, current_id: str) -> None:
    session.query(Plan).filter(Plan.id != current_id, Plan.is_recommended.is_(True)).update(
        {"is_recommended": False}
    )
