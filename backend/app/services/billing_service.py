from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database.models.plan import Plan
from app.database.models.subscription import (
    PaymentEventLog,
    PaymentProvider,
    Subscription,
    SubscriptionStatus,
)
from app.database.models.user import User
from app.errors import AppError, ErrorCode
from app.integrations.payments import get_payment_provider
from app.logging import get_logger
from app.schemas.billing import (
    ConfirmSessionRequest,
    BillingConfigResponse,
    CheckoutSessionResponse,
    CreateCheckoutRequest,
    CreatePortalRequest,
    PortalSessionResponse,
    SubscriptionResponse,
)
from app.schemas.plan import PlanRead

logger = get_logger(__name__)


class BillingService:
    """Core SaaS billing domain service managing subscriptions, checkouts & webhooks."""

    def get_config(self) -> BillingConfigResponse:
        settings = get_settings()
        return BillingConfigResponse(
            default_provider=settings.default_payment_provider or "stripe",
            stripe_publishable_key=settings.stripe_publishable_key,
            stripe_currency=settings.stripe_currency or "usd",
            razorpay_key_id=settings.razorpay_key_id or None,
        )

    def get_subscription(self, session: Session, user: User) -> SubscriptionResponse:
        settings = get_settings()
        sub = session.scalar(select(Subscription).where(Subscription.user_id == user.id))
        plan = session.get(Plan, sub.plan_id if sub else (user.plan_id or "starter"))

        now = datetime.now(timezone.utc)

        if sub:
            trial_remaining = 0
            if sub.trial_ends_at:
                diff = sub.trial_ends_at - now
                trial_remaining = max(0, diff.days)

            is_active = sub.status in (SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING)

            return SubscriptionResponse(
                has_subscription=True,
                provider=sub.provider,
                provider_customer_id=sub.provider_customer_id,
                provider_subscription_id=sub.provider_subscription_id,
                plan_id=sub.plan_id,
                plan=PlanRead.model_validate(plan) if plan else None,
                billing_cycle=sub.billing_cycle,
                status=sub.status,
                is_active=is_active,
                trial_start_at=sub.trial_start_at,
                trial_ends_at=sub.trial_ends_at,
                trial_days_remaining=trial_remaining,
                current_period_start=sub.current_period_start,
                current_period_end=sub.current_period_end,
                cancel_at_period_end=sub.cancel_at_period_end,
                campaigns_limit=plan.max_campaigns if plan else 5,
                daily_actions_limit=plan.daily_action_limit if plan else 50,
                monthly_prospects_limit=plan.monthly_ai_prospects if plan else 1000,
            )

        # Implicit initial 14-day trial without connected card
        trial_days = plan.trial_days if plan else 14
        user_created = user.created_at or now
        diff = (user_created.timestamp() + trial_days * 86400) - now.timestamp()
        trial_remaining = max(0, int(diff // 86400))
        is_active = trial_remaining > 0

        return SubscriptionResponse(
            has_subscription=False,
            provider=PaymentProvider.STRIPE,
            plan_id=plan.id if plan else "starter",
            plan=PlanRead.model_validate(plan) if plan else None,
            billing_cycle=user.billing_cycle or "monthly",
            status=SubscriptionStatus.TRIALING if is_active else SubscriptionStatus.PAST_DUE,
            is_active=is_active,
            trial_days_remaining=trial_remaining,
            campaigns_limit=plan.max_campaigns if plan else 5,
            daily_actions_limit=plan.daily_action_limit if plan else 50,
            monthly_prospects_limit=plan.monthly_ai_prospects if plan else 1000,
        )

    async def create_checkout_session(
        self, session: Session, user: User, payload: CreateCheckoutRequest
    ) -> CheckoutSessionResponse:
        settings = get_settings()

        # Validate requested plan
        plan = session.get(Plan, payload.plan_id)
        if not plan or not plan.is_active:
            raise AppError(
                code=ErrorCode.NOT_FOUND,
                message=f"Plan '{payload.plan_id}' does not exist or is inactive.",
                http_status=404,
            )

        provider = get_payment_provider(payload.provider, payload.currency)

        # Build redirect URLs
        app_base = (settings.app_base_url or "http://localhost:5173").rstrip("/")
        success_url = payload.success_url or f"{app_base}/settings?tab=billing&session_id={{CHECKOUT_SESSION_ID}}&status=success"
        cancel_url = payload.cancel_url or f"{app_base}/settings?tab=billing&status=cancelled"

        # Check existing subscription for trial eligibility
        sub = session.scalar(select(Subscription).where(Subscription.user_id == user.id))
        trial_days = plan.trial_days if (not sub or not sub.provider_subscription_id) else 0

        result = await provider.create_checkout_session(
            user=user,
            plan=plan,
            billing_cycle=payload.billing_cycle,
            success_url=success_url,
            cancel_url=cancel_url,
            trial_days=trial_days,
        )

        return CheckoutSessionResponse(
            provider=result.provider,
            checkout_url=result.checkout_url,
            session_id=result.session_id,
            order_id=result.order_id,
            client_payload=result.client_payload,
        )

    async def confirm_session(
        self, session: Session, user: User, session_id: str
    ) -> SubscriptionResponse:
        """Confirm a completed checkout session directly from Stripe and activate subscription."""
        provider = get_payment_provider(PaymentProvider.STRIPE)
        if not hasattr(provider, "retrieve_checkout_session"):
            raise AppError(
                code=ErrorCode.CAPABILITY_UNSUPPORTED,
                message="Direct checkout confirmation is not supported by provider.",
                http_status=400,
            )

        session_data = await provider.retrieve_checkout_session(session_id)
        metadata = session_data.get("metadata") or {}
        user_id_meta = str(metadata.get("user_id", ""))

        if user_id_meta and user_id_meta != str(user.id):
            raise AppError(
                code=ErrorCode.CONFLICT,
                message="Checkout session does not belong to the current authenticated user.",
                http_status=403,
            )

        status = session_data.get("status")
        payment_status = session_data.get("payment_status")
        if status not in ("complete", "open") and payment_status not in ("paid", "no_payment_required"):
            logger.info("Checkout session %s not in complete state (%s, %s)", session_id, status, payment_status)
            return self.get_subscription(session, user)

        customer_id = session_data.get("customer")
        subscription_obj = session_data.get("subscription")
        subscription_data = subscription_obj if isinstance(subscription_obj, dict) else {}
        sub_id = subscription_data.get("id") or (subscription_obj if isinstance(subscription_obj, str) else None)

        plan_id = str(metadata.get("plan_id") or user.plan_id or "starter").lower()
        billing_cycle = str(metadata.get("billing_cycle") or user.billing_cycle or "monthly").lower()

        sub = session.scalar(select(Subscription).where(Subscription.user_id == user.id))
        is_trial = bool(subscription_data.get("trial_end"))
        sub_status = SubscriptionStatus.TRIALING if is_trial else SubscriptionStatus.ACTIVE

        if not sub:
            sub = Subscription(
                user_id=user.id,
                provider=PaymentProvider.STRIPE,
                provider_customer_id=str(customer_id) if customer_id else None,
                provider_subscription_id=str(sub_id) if sub_id else None,
                plan_id=plan_id,
                billing_cycle=billing_cycle,
                status=sub_status,
            )
            session.add(sub)
        else:
            if customer_id:
                sub.provider_customer_id = str(customer_id)
            if sub_id:
                sub.provider_subscription_id = str(sub_id)
            sub.plan_id = plan_id
            sub.billing_cycle = billing_cycle
            sub.status = sub_status

        if trial_end := subscription_data.get("trial_end"):
            if isinstance(trial_end, (int, float)):
                sub.trial_ends_at = datetime.fromtimestamp(trial_end, tz=timezone.utc)
        if period_end := subscription_data.get("current_period_end"):
            if isinstance(period_end, (int, float)):
                sub.current_period_end = datetime.fromtimestamp(period_end, tz=timezone.utc)

        user.plan_id = plan_id
        session.commit()
        session.refresh(sub)
        logger.info("Successfully confirmed session %s: user %s activated on plan %s", session_id, user.id, plan_id)

        return self.get_subscription(session, user)

    async def create_portal_session(
        self, session: Session, user: User, payload: CreatePortalRequest
    ) -> PortalSessionResponse:
        settings = get_settings()
        sub = session.scalar(select(Subscription).where(Subscription.user_id == user.id))

        if not sub or not sub.provider_customer_id:
            # If user has no Stripe customer yet, attempt customer provisioning
            provider = get_payment_provider()
            if hasattr(provider, "get_or_create_customer"):
                customer_id = await provider.get_or_create_customer(user)
                if not sub:
                    sub = Subscription(
                        user_id=user.id,
                        provider=PaymentProvider.STRIPE,
                        provider_customer_id=customer_id,
                        plan_id=user.plan_id or "starter",
                        status=SubscriptionStatus.TRIALING,
                    )
                    session.add(sub)
                    session.commit()
            else:
                raise AppError(
                    code=ErrorCode.NOT_FOUND,
                    message="No active billing customer record found. Please subscribe to a plan first.",
                    http_status=404,
                )

        app_base = (settings.app_base_url or "http://localhost:5173").rstrip("/")
        return_url = payload.return_url or f"{app_base}/settings?tab=billing"

        provider = get_payment_provider(sub.provider)
        result = await provider.create_portal_session(sub.provider_customer_id, return_url)

        return PortalSessionResponse(portal_url=result.portal_url)

    async def process_webhook(
        self,
        session: Session,
        provider_name: PaymentProvider,
        raw_body: bytes,
        headers: dict[str, str],
    ) -> dict[str, Any]:
        """Cryptographically verifies incoming webhook and guarantees at-most-once processing."""
        provider = get_payment_provider(provider_name)
        event = await provider.verify_and_parse_webhook(raw_body, headers)

        # Idempotency guard: prevent replay attacks and duplicate processing
        existing_log = session.get(PaymentEventLog, event.event_id)
        if existing_log:
            logger.info(
                "Payment webhook event %s (%s) already processed. Skipping.",
                event.event_id,
                event.event_type,
            )
            return {"status": "ignored", "reason": "already_processed"}

        # Record event in idempotency log
        event_log = PaymentEventLog(
            id=event.event_id,
            provider=event.provider,
            event_type=event.event_type,
            processed_at=datetime.now(timezone.utc),
            payload_summary=json.dumps(event.raw_payload)[:1000] if event.raw_payload else None,
        )
        session.add(event_log)

        # Resolve affected user
        user: User | None = None
        user_id_meta = event.raw_payload.get("metadata", {}).get("user_id")
        if user_id_meta:
            try:
                user = session.get(User, int(user_id_meta))
            except (ValueError, TypeError):
                pass

        if not user and event.customer_id:
            sub_by_cust = session.scalar(
                select(Subscription).where(Subscription.provider_customer_id == event.customer_id)
            )
            if sub_by_cust:
                user = session.get(User, sub_by_cust.user_id)

        if not user:
            logger.warning(
                "Webhook event %s has customer %s but no matching user in workspace",
                event.event_id,
                event.customer_id,
            )
            session.commit()
            return {"status": "logged_no_user"}

        # Fetch or initialize subscription record
        sub = session.scalar(select(Subscription).where(Subscription.user_id == user.id))
        if not sub:
            sub = Subscription(
                user_id=user.id,
                provider=event.provider,
                provider_customer_id=event.customer_id,
                plan_id=event.plan_id or user.plan_id or "starter",
                status=event.status,
            )
            session.add(sub)

        # Update subscription state
        sub.provider = event.provider
        sub.provider_customer_id = event.customer_id
        if event.subscription_id:
            sub.provider_subscription_id = event.subscription_id
        if event.price_id:
            sub.provider_price_id = event.price_id
        if event.plan_id:
            sub.plan_id = event.plan_id
            user.plan_id = event.plan_id

        sub.status = event.status
        if event.trial_start_at:
            sub.trial_start_at = event.trial_start_at
        if event.trial_ends_at:
            sub.trial_ends_at = event.trial_ends_at
        if event.current_period_start:
            sub.current_period_start = event.current_period_start
        if event.current_period_end:
            sub.current_period_end = event.current_period_end
        sub.cancel_at_period_end = event.cancel_at_period_end

        session.commit()
        logger.info(
            "Successfully synced subscription for user %s (%s): status=%s plan=%s",
            user.id,
            user.email,
            sub.status.value,
            sub.plan_id,
        )

        return {"status": "success", "event_id": event.event_id, "subscription_status": sub.status.value}


_billing_service: BillingService | None = None


def get_billing_service() -> BillingService:
    global _billing_service
    if _billing_service is None:
        _billing_service = BillingService()
    return _billing_service

