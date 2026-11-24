from __future__ import annotations

from fastapi import APIRouter, Header, Request, status

from app.api.deps import CurrentUser, DbSession
from app.database.models.subscription import PaymentProvider
from app.schemas.billing import (
    BillingConfigResponse,
    CheckoutSessionResponse,
    ConfirmSessionRequest,
    CreateCheckoutRequest,
    CreatePortalRequest,
    PortalSessionResponse,
    SubscriptionResponse,
)
from app.services.billing_service import get_billing_service

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get("/config", response_model=BillingConfigResponse)
def get_billing_config() -> BillingConfigResponse:
    """Safe public endpoint delivering active Stripe publishable key and currency."""
    service = get_billing_service()
    return service.get_config()


@router.get("/subscription", response_model=SubscriptionResponse)
def get_user_subscription(current_user: CurrentUser, session: DbSession) -> SubscriptionResponse:
    """Returns the authenticated user's current subscription, plan, and trial countdown."""
    service = get_billing_service()
    return service.get_subscription(session, current_user)


@router.post("/create-checkout-session", response_model=CheckoutSessionResponse)
async def create_checkout_session(
    current_user: CurrentUser,
    session: DbSession,
    payload: CreateCheckoutRequest,
) -> CheckoutSessionResponse:
    """Create a hosted Stripe/Razorpay checkout session with 14-day free trial."""
    service = get_billing_service()
    return await service.create_checkout_session(session, current_user, payload)


@router.post("/confirm-session", response_model=SubscriptionResponse)
async def confirm_checkout_session(
    current_user: CurrentUser,
    session: DbSession,
    payload: ConfirmSessionRequest,
) -> SubscriptionResponse:
    """Confirm a completed checkout session directly from Stripe and activate subscription."""
    service = get_billing_service()
    return await service.confirm_session(session, current_user, payload.session_id)


@router.post("/create-portal-session", response_model=PortalSessionResponse)
async def create_portal_session(
    current_user: CurrentUser,
    session: DbSession,
    payload: CreatePortalRequest,
) -> PortalSessionResponse:
    """Create an authenticated Stripe Customer Portal session for card updates & invoices."""
    service = get_billing_service()
    return await service.create_portal_session(session, current_user, payload)


@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request, session: DbSession):
    """Raw cryptographic Stripe webhook listener with signature verification & idempotency."""
    raw_body = await request.body()
    headers = dict(request.headers)
    service = get_billing_service()
    return await service.process_webhook(
        session=session,
        provider_name=PaymentProvider.STRIPE,
        raw_body=raw_body,
        headers=headers,
    )


@router.post("/webhooks/razorpay")
async def razorpay_webhook(request: Request, session: DbSession):
    """Razorpay webhook listener with signature verification & idempotency."""
    raw_body = await request.body()
    headers = dict(request.headers)
    service = get_billing_service()
    return await service.process_webhook(
        session=session,
        provider_name=PaymentProvider.RAZORPAY,
        raw_body=raw_body,
        headers=headers,
    )

