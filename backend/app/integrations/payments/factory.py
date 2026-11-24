from __future__ import annotations

from app.config import get_settings
from app.database.models.subscription import PaymentProvider
from app.integrations.payments.base import BasePaymentProvider
from app.integrations.payments.razorpay_provider import RazorpayPaymentProvider
from app.integrations.payments.stripe_provider import StripePaymentProvider


def get_payment_provider(
    provider_name: str | PaymentProvider | None = None,
    currency: str | None = None,
) -> BasePaymentProvider:
    """Factory creating or resolving active payment provider.

    Smart Geo/Currency Routing:
    - If provider is explicitly specified (e.g. 'stripe' or 'razorpay'), use it.
    - If currency is 'INR', default to Razorpay when configured.
    - Otherwise, default to Stripe.
    """
    settings = get_settings()

    target = (
        str(provider_name).lower()
        if provider_name
        else (settings.default_payment_provider or "stripe").lower()
    )

    if currency and currency.upper() == "INR" and settings.razorpay_key_id:
        target = "razorpay"

    if target in ("razorpay", PaymentProvider.RAZORPAY.value):
        return RazorpayPaymentProvider()

    return StripePaymentProvider()

