from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import stripe

from app.config import get_settings
from app.database.models.subscription import PaymentProvider, SubscriptionStatus
from app.errors import AppError, ErrorCode
from app.integrations.payments.base import (
    BasePaymentProvider,
    CheckoutResult,
    NormalizedPaymentEvent,
    PortalResult,
)
from app.logging import get_logger

logger = get_logger(__name__)


def _to_dict(obj: Any) -> dict[str, Any]:
    """Safely convert StripeObject, Model, or dict to standard python dictionary."""
    if hasattr(obj, "to_dict") and callable(obj.to_dict):
        try:
            return obj.to_dict()
        except Exception:
            pass
    if isinstance(obj, dict):
        return obj
    return {}


class StripePaymentProvider(BasePaymentProvider):
    """Production-grade Stripe payment provider supporting Checkout, Portal & Webhooks."""

    def __init__(
        self,
        api_key: str | None = None,
        webhook_secret: str | None = None,
        currency: str | None = None,
    ):
        settings = get_settings()
        self.api_key = (api_key or settings.stripe_secret_key).strip()
        self.webhook_secret = (webhook_secret or settings.stripe_webhook_secret).strip()
        self.currency = (currency or settings.stripe_currency or "usd").lower().strip()
        stripe.api_key = self.api_key

    def _resolve_price_id(self, plan: Any, billing_cycle: str) -> str | None:
        """Find configured Stripe price ID from plan or settings."""
        settings = get_settings()
        is_annual = billing_cycle.lower() == "annual"

        # Check plan model first
        if is_annual and getattr(plan, "stripe_annual_price_id", None):
            return str(plan.stripe_annual_price_id).strip()
        if not is_annual and getattr(plan, "stripe_monthly_price_id", None):
            return str(plan.stripe_monthly_price_id).strip()

        # Fallback to application settings
        plan_id = str(getattr(plan, "id", "")).lower()
        if plan_id in ("starter", "basic"):
            return (
                settings.stripe_price_starter_annual
                if is_annual
                else settings.stripe_price_starter_monthly
            ) or None
        if plan_id in ("growth", "pro", "professional"):
            return (
                settings.stripe_price_growth_annual
                if is_annual
                else settings.stripe_price_growth_monthly
            ) or None
        if plan_id in ("scale", "enterprise"):
            return (
                settings.stripe_price_scale_annual
                if is_annual
                else settings.stripe_price_scale_monthly
            ) or None

        return None

    async def get_or_create_customer(self, user: Any) -> str:
        """Find existing Stripe customer or create a new one bound to user."""
        if not self.api_key:
            raise AppError(
                code=ErrorCode.SERVICE_UNAVAILABLE,
                message="Stripe payments are not configured. Please set STRIPE_SECRET_KEY.",
                http_status=503,
            )

        user_id = str(getattr(user, "id", ""))
        user_email = str(getattr(user, "email", "")).strip()
        full_name = getattr(user, "full_name", None) or user_email

        try:
            # Check if customer already exists by email
            existing = stripe.Customer.list(email=user_email, limit=1)
            if existing and existing.data:
                customer = existing.data[0]
                cust_meta = _to_dict(_to_dict(customer).get("metadata", {}))
                # Update user_id metadata if missing
                if str(cust_meta.get("user_id", "")) != user_id:
                    stripe.Customer.modify(customer.id, metadata={"user_id": user_id})
                return str(customer.id)

            # Create new Stripe customer
            customer = stripe.Customer.create(
                email=user_email,
                name=full_name,
                metadata={"user_id": user_id},
            )
            return str(customer.id)
        except stripe.StripeError as exc:
            logger.error("Failed to get or create Stripe customer for user %s: %s", user_id, exc)
            raise AppError(
                code=ErrorCode.EXTERNAL_SERVICE_ERROR,
                message="Unable to set up customer billing profile. Please try again or contact support.",
                http_status=502,
                details={"provider": "stripe", "type": exc.__class__.__name__},
            ) from exc

    async def create_checkout_session(
        self,
        user: Any,
        plan: Any,
        billing_cycle: str,
        success_url: str,
        cancel_url: str,
        trial_days: int = 14,
    ) -> CheckoutResult:
        """Create a hosted Stripe Checkout session for subscription."""
        customer_id = await self.get_or_create_customer(user)
        price_id = self._resolve_price_id(plan, billing_cycle)

        # Build session arguments (dynamic payment methods managed by Stripe Dashboard)
        session_args: dict[str, Any] = {
            "customer": customer_id,
            "mode": "subscription",
            "success_url": success_url,
            "cancel_url": cancel_url,
            "metadata": {
                "user_id": str(getattr(user, "id", "")),
                "plan_id": str(getattr(plan, "id", "starter")),
                "billing_cycle": billing_cycle.lower(),
            },
        }

        # Apply trial days if eligible
        if trial_days >  0:
            session_args["subscription_data"] = {
                "trial_period_days": trial_days,
                "metadata": session_args["metadata"],
            }
        else:
            session_args["subscription_data"] = {
                "metadata": session_args["metadata"],
            }

        # Use pre-configured price ID if available, else dynamic recurring price_data
        if price_id:
            session_args["line_items"] = [{"price": price_id, "quantity": 1}]
        else:
            amount = float(
                getattr(plan, "annual_price" if billing_cycle.lower() == "annual" else "monthly_price", 39.0)
            )
            interval = "year" if billing_cycle.lower() == "annual" else "month"
            unit_amount = round(amount * 100)
            plan_name = getattr(plan, "name", "Subscription Plan")

            product_data: dict[str, Any] = {"name": f"{plan_name} ({billing_cycle.title()})"}
            if plan_desc := getattr(plan, "description", None):
                product_data["description"] = str(plan_desc)[:500]

            session_args["line_items"] = [
                {
                    "price_data": {
                        "currency": self.currency,
                        "product_data": product_data,
                        "unit_amount": unit_amount,
                        "recurring": {"interval": interval},
                    },
                    "quantity": 1,
                }
            ]

        try:
            session = stripe.checkout.Session.create(**session_args)
            return CheckoutResult(
                provider=PaymentProvider.STRIPE,
                checkout_url=session.url,
                session_id=session.id,
            )
        except stripe.StripeError as exc:
            logger.error("Failed to create Stripe checkout session: %s", exc)
            raise AppError(
                code=ErrorCode.EXTERNAL_SERVICE_ERROR,
                message="Unable to initiate checkout session. Please try again shortly or contact support.",
                http_status=502,
                details={"provider": "stripe", "type": exc.__class__.__name__},
            ) from exc

    async def retrieve_checkout_session(self, session_id: str) -> dict[str, Any]:
        """Retrieve a checkout session and associated subscription from Stripe."""
        if not self.api_key:
            raise AppError(
                code=ErrorCode.SERVICE_UNAVAILABLE,
                message="Stripe is not configured.",
                http_status=503,
            )
        try:
            session = stripe.checkout.Session.retrieve(session_id, expand=["subscription"])
            return _to_dict(session)
        except stripe.StripeError as exc:
            logger.error("Failed to retrieve Stripe checkout session %s: %s", session_id, exc)
            raise AppError(
                code=ErrorCode.EXTERNAL_SERVICE_ERROR,
                message="Unable to verify checkout session with Stripe.",
                http_status=502,
                details={"provider": "stripe", "type": exc.__class__.__name__},
            ) from exc

    async def create_portal_session(self, customer_id: str, return_url: str) -> PortalResult:
        """Create a Stripe Customer Portal session for billing management."""
        if not self.api_key:
            raise AppError(
                code=ErrorCode.SERVICE_UNAVAILABLE,
                message="Stripe payments are not configured.",
                http_status=503,
            )

        try:
            portal_session = stripe.billing_portal.Session.create(
                customer=customer_id,
                return_url=return_url,
            )
            return PortalResult(
                provider=PaymentProvider.STRIPE,
                portal_url=portal_session.url,
            )
        except stripe.StripeError as exc:
            logger.error("Failed to create Stripe customer portal session: %s", exc)
            raise AppError(
                code=ErrorCode.EXTERNAL_SERVICE_ERROR,
                message="Unable to open customer billing portal. Please try again shortly.",
                http_status=502,
                details={"provider": "stripe", "type": exc.__class__.__name__},
            ) from exc

    async def verify_and_parse_webhook(
        self, raw_body: bytes, headers: dict[str, str]
    ) -> NormalizedPaymentEvent:
        """Validate HMAC signature with raw bytes and normalize event."""
        sig_header = headers.get("stripe-signature")
        if not sig_header:
            raise AppError(
                code=ErrorCode.VALIDATION_ERROR,
                message="Missing stripe-signature header",
                http_status=400,
            )

        try:
            event = stripe.Webhook.construct_event(
                payload=raw_body,
                sig_header=sig_header,
                secret=self.webhook_secret,
            )
        except stripe.SignatureVerificationError as exc:
            logger.warning("Stripe webhook signature verification failed: %s", exc)
            raise AppError(
                code=ErrorCode.VALIDATION_ERROR,
                message="Invalid Stripe webhook signature",
                http_status=400,
            ) from exc
        except Exception as exc:
            logger.error("Stripe webhook parsing failed: %s", exc)
            raise AppError(
                code=ErrorCode.VALIDATION_ERROR,
                message=f"Webhook parsing error: {exc}",
                http_status=400,
            ) from exc

        event_dict = _to_dict(event)
        event_type = str(event_dict.get("type", ""))
        data_wrapper = _to_dict(event_dict.get("data", {}))
        data_object = _to_dict(data_wrapper.get("object", {}))

        # Normalize timestamps helper
        def _to_dt(ts: int | None) -> datetime | None:
            if ts and isinstance(ts, (int, float)):
                return datetime.fromtimestamp(ts, tz=UTC)
            return None

        # Extract customer & subscription IDs
        customer_id = data_object.get("customer") or data_object.get("id") or ""
        subscription_id = data_object.get("subscription") or (
            data_object.get("id") if event_type.startswith("customer.subscription") else None
        )

        metadata = _to_dict(data_object.get("metadata", {}))
        plan_id = metadata.get("plan_id")
        raw_status = str(data_object.get("status", "active"))

        # Map status to unified SubscriptionStatus enum
        status_map: dict[str, SubscriptionStatus] = {
            "trialing": SubscriptionStatus.TRIALING,
            "active": SubscriptionStatus.ACTIVE,
            "past_due": SubscriptionStatus.PAST_DUE,
            "canceled": SubscriptionStatus.CANCELED,
            "unpaid": SubscriptionStatus.UNPAID,
            "incomplete": SubscriptionStatus.INCOMPLETE,
        }
        status = status_map.get(raw_status, SubscriptionStatus.ACTIVE)

        trial_start = _to_dt(data_object.get("trial_start"))
        trial_ends = _to_dt(data_object.get("trial_end"))
        period_start = _to_dt(data_object.get("current_period_start"))
        period_end = _to_dt(data_object.get("current_period_end"))
        cancel_at_period_end = bool(data_object.get("cancel_at_period_end", False))

        return NormalizedPaymentEvent(
            provider=PaymentProvider.STRIPE,
            event_id=event["id"],
            event_type=event_type,
            customer_id=str(customer_id),
            subscription_id=str(subscription_id) if subscription_id else None,
            plan_id=plan_id,
            status=status,
            trial_start_at=trial_start,
            trial_ends_at=trial_ends,
            current_period_start=period_start,
            current_period_end=period_end,
            cancel_at_period_end=cancel_at_period_end,
            raw_payload=data_object,
        )

    async def cancel_subscription(self, subscription_id: str) -> bool:
        """Cancel subscription at period end."""
        try:
            stripe.Subscription.modify(subscription_id, cancel_at_period_end=True)
            return True
        except stripe.StripeError as exc:
            logger.error("Failed to cancel Stripe subscription %s: %s", subscription_id, exc)
            return False

