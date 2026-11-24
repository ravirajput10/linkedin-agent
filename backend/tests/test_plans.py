from __future__ import annotations

import pytest
from app.schemas.plan import PlanCreate, PlanUpdate, UserPlanUpdate
from app.services import plan_service


def test_plan_crud_lifecycle(db):
    # 1. Create a plan
    create_dto = PlanCreate(
        id="test_plan",
        name="Test Plan",
        description="A plan for automated tests",
        monthly_price=19.0,
        annual_price=15.0,
        trial_days=7,
        badge="Special",
        is_recommended=True,
        is_active=True,
        sort_order=5,
        features=["Automated Testing", "Test Suite Quota"],
    )
    plan = plan_service.create_plan(db, create_dto)
    assert plan.id == "test_plan"
    assert plan.name == "Test Plan"
    assert float(plan.monthly_price) == 19.0
    assert plan.is_recommended is True

    # 2. Get the plan
    fetched = plan_service.get_plan(db, "test_plan")
    assert fetched.id == "test_plan"
    assert fetched.badge == "Special"

    # 3. Update the plan
    update_dto = PlanUpdate(
        name="Updated Test Plan",
        monthly_price=25.0,
        badge="Updated Badge",
    )
    updated = plan_service.update_plan(db, "test_plan", update_dto)
    assert updated.name == "Updated Test Plan"
    assert float(updated.monthly_price) == 25.0
    assert updated.badge == "Updated Badge"

    # 4. Toggle active
    toggled = plan_service.toggle_active(db, "test_plan")
    assert toggled.is_active is False
    toggled_again = plan_service.toggle_active(db, "test_plan")
    assert toggled_again.is_active is True

    # 5. List active plans
    active_plans = plan_service.list_active_plans(db)
    assert any(p.id == "test_plan" for p in active_plans)

    # 6. Delete plan
    plan_service.delete_plan(db, "test_plan")
    with pytest.raises(Exception):
        plan_service.get_plan(db, "test_plan")
