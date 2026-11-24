from fastapi import APIRouter

from app.api import (
    activity,
    admin,
    billing,
    agent,
    approvals,
    audiences,
    auth,
    campaigns,
    candidates,
    dashboard,
    integrations,
    plans,
    posts,
    scheduled_actions,
    settings,
    content_studio,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(agent.router)
api_router.include_router(audiences.router)
api_router.include_router(plans.router)
api_router.include_router(billing.router)
api_router.include_router(admin.router)
api_router.include_router(dashboard.router)
api_router.include_router(campaigns.router)
api_router.include_router(candidates.router)
api_router.include_router(posts.router)
api_router.include_router(approvals.router)
api_router.include_router(scheduled_actions.router)
api_router.include_router(integrations.router)
api_router.include_router(activity.router)
api_router.include_router(settings.router)
api_router.include_router(content_studio.router)

