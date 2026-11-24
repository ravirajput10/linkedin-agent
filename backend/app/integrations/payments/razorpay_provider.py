from __future__ import annotations

import hmac
import hashlib
from typing import Any

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


class RazorpayPaymentProvider(BasePaymentProvider):
    """Razorpay payment provider adapter (Domestic Indian Cards, UPI, Netbanking)."""

    def __init__(
        self,
        key_id: str | None = None,
        key_secret: str | None = None,
        webhook_secret: str | None = None,
    ):
        settings = get_settings()
        self.key_id = (key_id or settings.razorpay_key_id).strip()
        self.key_secret = (key_secret or settings.razorpay_key_secret).strip()
        self.webhook_secret = (webhook_secret or settings.razorpay_webhook_secret).strip()

    async def create_checkout_session(
        self,
        user: Any,
        plan: Any,
        billing_cycle: str,
        success_url: str,
        cancel_url: str,
        trial_days: int = 14,
    ) -> CheckoutResult:
        if not self.key_id or not self.key_secret:
            raise AppError(
                code=ErrorCode.SERVICE_UNAVAILABLE,
                message="Razorpay gateway is not configured.",
                http_status=503,
            )

        amount_inr = float(getattr(plan, "monthly_price", 39.0)) * 83.0  # Approx or INR tier price
        amount_paise = int(round(amount_inr * 100))

        client_payload = {
            "key": self.key_id,
            "amount": amount_paise,
            "currency": "INR",
            "name": "Kestrel LinkedIn Agent",
            "description": f"{getattr(plan, 'name', 'Plan')} ({billing_cycle})",
            "prefill": {
                "name": getattr(user, "full_name", "") or "",
                "email": getattr(user, "email", "") or "",
            },
            "theme": {"color": "#0A66C2"},
        }

        return CheckoutResult(
            provider=PaymentProvider.RAZORPAY,
            client_payload=client_payload,
        )

    async def create_portal_session(self, customer_id: str, return_url: str) -> PortalResult:
        # Razorpay Customer Portal standard redirect URL
        return PortalResult(
            provider=PaymentProvider.RAZORPAY,
            portal_url=return_url,
        )

    async def verify_and_parse_webhook(
        self, raw_body: bytes, headers: dict[str, str]
    ) -> NormalizedPaymentEvent:
        sig_header = headers.get("x-razorpay-signature")
        if not sig_header or not self.webhook_secret:
            raise AppError(
                code=ErrorCode.VALIDATION_ERROR,
                message="Missing Razorpay signature or webhook secret",
                http_status=400,
            )

        # Compute HMAC SHA256
        expected_sig = hmac.new(
            self.webhook_secret.encode("utf-8"), raw_body, hashlib.sha256
        ).hexdigest()

        if not hmac.compare_digest(sig_header, expected_sig):
            raise AppError(
                code=ErrorCode.VALIDATION_ERROR,
                message="Invalid Razorpay webhook signature",
                http_status=400,
            )

        import json

        payload = json.loads(raw_body.decode("utf-8"))
        event_id = payload.get("event_id") or "rzp_evt"
        event_type = payload.get("event")

        return NormalizedPaymentEvent(
            provider=PaymentProvider.RAZORPAY,
            event_id=event_id,
            event_type=event_type,
            customer_id="",
            status=SubscriptionStatus.ACTIVE,
            raw_payload=payload,
        )

    async def cancel_subscription(self, subscription_id: str) -> bool:
        return True

