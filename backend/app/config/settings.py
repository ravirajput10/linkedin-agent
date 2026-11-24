"""Application configuration.

Environment files are selected by ``APP_ENV`` so that local and production
deployments keep separate property files:

    APP_ENV=local       -> backend/.env.local
    APP_ENV=production  -> backend/.env.production
    APP_ENV=test        -> backend/.env.test

A plain ``backend/.env`` is loaded first as a base layer when present.
"""

from __future__ import annotations

import os
from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import ClassVar

from pydantic import Field, computed_field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]


class AppEnv(StrEnum):
    LOCAL = "local"
    DEVELOPMENT = "development"
    TEST = "test"
    PRODUCTION = "production"


class LLMProviderName(StrEnum):
    CLAUDE = "claude"
    LOCAL = "local"
    MOCK = "mock"


class PlatformAdapterName(StrEnum):
    MOCK = "mock"
    LINKEDIN = "linkedin"
    BRIGHTDATA = "brightdata"
    UNIPILE = "unipile"
    #: Reads from one adapter, writes through another. The recommended live
    #: setup: Bright Data for discovery and posts, Unipile for engagement.
    COMPOSITE = "composite"


def _env_files() -> tuple[str, ...]:
    app_env = os.getenv("APP_ENV", AppEnv.LOCAL.value).strip().lower()
    project_root = BACKEND_ROOT.parent
    candidates = [
        project_root / ".env",
        project_root / f".env.{app_env}",
        BACKEND_ROOT / ".env",
        BACKEND_ROOT / f".env.{app_env}",
    ]
    return tuple(str(path) for path in candidates if path.exists())


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_env_files(),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ------------------------------------------------------------------ app --
    app_env: AppEnv = AppEnv.LOCAL
    app_name: str = "AI LinkedIn Engagement Agent"
    api_prefix: str = "/api"
    debug: bool = True
    secret_key: str = Field(default="change-me-in-production", min_length=8)
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:3000,https://staging.divergentsl.com"

    # ------------------------------------------------------------------ auth --
    #: Signing key for access/refresh tokens. Falls back to ``secret_key`` so a
    #: single value is enough for local work; set it separately in production so
    #: rotating session signing does not invalidate anything else.
    jwt_secret_key: str = ""
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 14

    #: Turn off to close public sign-up; admins can still create users.
    allow_registration: bool = True
    #: Future flag. When true a new account lands in PENDING_VERIFICATION and
    #: cannot log in until the emailed token is confirmed. The token is issued
    #: and stored either way, so turning this on needs no migration.
    require_email_verification: bool = False
    email_verification_token_hours: int = 48

    #: Seeded on startup when the users table is empty. Leave the password blank
    #: to skip seeding and use ``python -m scripts.create_admin`` instead.
    admin_email: str = ""
    admin_password: str = ""
    admin_full_name: str = "Administrator"

    min_password_length: int = 8

    #: Wrong passwords in a row before an account is locked. Per account, so it
    #: holds against a botnet that spreads its guesses across many IPs; the
    #: per-IP limit lives in nginx.
    login_max_failed_attempts: int = 10
    login_lockout_minutes: int = 15

    #: Lifetime of the signed ``state`` sent through LinkedIn's OAuth redirect.
    oauth_state_expire_minutes: int = 10

    # ------------------------------------------------------------- database --
    db_host: str = "localhost"
    db_port: int = 5432
    db_user: str = "postgres"
    db_password: str = ""
    db_name: str = "linkedin_agent"
    db_schema: str = "linkedin_agent"
    db_echo: bool = False
    database_url: str | None = None

    # ---------------------------------------------------------------- redis --
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str | None = None
    celery_result_backend: str | None = None
    celery_task_always_eager: bool = False

    # ------------------------------------------------------------------ llm --
    llm_provider: LLMProviderName = LLMProviderName.CLAUDE
    llm_max_retries: int = 2
    llm_timeout_seconds: float = 120.0

    claude_api_key: str = ""
    claude_model: str = "claude-sonnet-4-5"
    claude_max_tokens: int = 4096

    local_llm_base_url: str = "http://localhost:11434"
    local_llm_model: str = "qwen3"
    local_llm_supports_structured_output: bool = True
    local_llm_max_context_tokens: int = 32768
    #: Hybrid reasoning models (qwen3, gpt-oss, deepseek-r1) emit a thinking pass
    #: that costs latency and tokens but adds little to classification work.
    #: None leaves the model default; False turns it off.
    local_llm_think: bool | None = None
    #: Hard ceiling on generated tokens. Every agent response observed in practice
    #: is well under 400 tokens; a much larger value here only buys time for a
    #: model that has started repeating itself. Hitting the cap truncates the
    #: JSON, which fails validation and triggers the repair retry — far better
    #: than a request that hangs until the timeout.
    local_llm_max_output_tokens: int = 1536

    # -------------------------------------------------------- prompt config --
    campaign_parser_prompt_version: str = "v1"
    candidate_evaluator_prompt_version: str = "v1"
    post_evaluator_prompt_version: str = "v1"
    comment_generator_prompt_version: str = "v1"
    connection_generator_prompt_version: str = "v1"
    post_generator_prompt_version: str = "v1"

    # --------------------------------------------------------------- agent ---
    dry_run: bool = True
    platform_adapter: PlatformAdapterName = PlatformAdapterName.MOCK
    connection_delay_hours: int = 48

    max_people_per_day: int = 20
    max_likes_per_day: int = 60
    max_comments_per_day: int = 15
    max_connections_per_day: int = 15
    max_people_per_run: int = 5

    min_action_delay_seconds: int = 30
    max_action_delay_seconds: int = 180

    initial_posts_to_like: int = 2
    evaluated_post_index: int = 3
    minimum_relevance_score: int = 75

    max_action_attempts: int = 3
    workflow_failure_threshold: int = 3

    # ----------------------------------------------------------- brightdata --
    brightdata_api_token: str = ""
    brightdata_base_url: str = "https://api.brightdata.com"
    #: Dataset ids from the Web Scraper API dashboard. The defaults are the ones
    #: Bright Data publishes in its own docs; confirm them against your account.
    brightdata_dataset_profile: str = "gd_l1viktl72bvl7bjuj0"
    brightdata_dataset_posts: str = "gd_lyy3tktm25m4avu764"
    brightdata_dataset_people_search: str = ""
    brightdata_poll_interval_seconds: float = 5.0
    #: Jobs queue before they run — observed 46s once and ~10min the next
    #: time for the identical request. Campaign runs happen in a Celery
    #: worker, so waiting is cheap; failing early is not.
    brightdata_poll_timeout_seconds: float = 1800.0
    #: The workflow needs about four eligible posts; fetching far more only
    #: burns records against the free tier.
    brightdata_max_posts_per_person: int = 10
    brightdata_post_lookback_days: int = 60

    # -------------------------------------------------------------- unipile --
    #: Per-tenant host from the Unipile dashboard, e.g. "api8.unipile.com:13843".
    unipile_dsn: str = ""
    unipile_api_key: str = ""
    #: The connected LinkedIn account Unipile acts as.
    unipile_account_id: str = ""
    #: classic | sales_navigator | recruiter. sales_navigator 403s without a seat.
    unipile_search_api: str = "classic"
    unipile_timeout_seconds: float = 60.0

    # ------------------------------------------------- unipile hosted auth --
    #: Where the browser is sent back to after the hosted wizard. The frontend
    #: origin, not the API's.
    app_base_url: str = "http://localhost:5173"
    #: Public origin of THIS API, used to build the webhook Unipile calls.
    #: localhost is unreachable from Unipile, so local development needs a
    #: tunnel (ngrok, Cloudflare Tunnel) and this set to its https URL.
    #: Blank is fine: without it no ``notify_url`` is sent and the connection
    #: is reconciled by polling instead. Set it in any deployment that has a
    #: public address — a push is immediate, a poll is not.
    public_api_base_url: str = ""
    #: Path segment on the webhook route. A second lock beside the per-link
    #: token: without it a scanner cannot even find the endpoint.
    unipile_webhook_secret: str = ""
    #: Hosted-auth links are single-use and short-lived; Unipile also expires
    #: them on its own daily restart.
    unipile_hosted_auth_expiry_minutes: int = 15

    # ------------------------------------------------------------ composite --
    composite_read_adapter: PlatformAdapterName = PlatformAdapterName.BRIGHTDATA
    composite_write_adapter: PlatformAdapterName = PlatformAdapterName.UNIPILE

    # --------------------------------------------------------------- linked --
    linkedin_client_id: str = ""
    linkedin_client_secret: str = ""
    linkedin_redirect_uri: str = "http://localhost:5173/auth/callback"

    # ------------------------------------------------- cloudflare turnstile ---
    #: Cloudflare Turnstile anti-bot challenge keys. Defaults to Cloudflare's
    #: Loaded strictly from the active environment / .env file.
    #: so testing and development run real verification without requiring credentials.
    cloudflare_turnstile_site_key: str = ""
    cloudflare_turnstile_secret_key: str = ""
    cloudflare_turnstile_verify_url: str = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

    # --------------------------------------------------- payments & billing ---
    default_payment_provider: str = "stripe"
    stripe_secret_key: str = ""
    stripe_publishable_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_currency: str = "usd"

    stripe_price_starter_monthly: str = ""
    stripe_price_starter_annual: str = ""
    stripe_price_growth_monthly: str = ""
    stripe_price_growth_annual: str = ""
    stripe_price_scale_monthly: str = ""
    stripe_price_scale_annual: str = ""

    # Optional Razorpay configuration (dormant until enabled)
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""

    # ------------------------------------------------------------- logging ---
    log_level: str = "INFO"
    log_json: bool = False

    @field_validator("cors_origins")
    @classmethod
    def _strip_origins(cls, value: str) -> str:
        return value.strip()

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @computed_field  # type: ignore[prop-decorator]
    @property
    def sqlalchemy_url(self) -> str:
        if self.database_url:
            return self.database_url
        from urllib.parse import quote_plus

        password = f":{quote_plus(self.db_password)}" if self.db_password else ""
        return (
            f"postgresql+psycopg://{quote_plus(self.db_user)}{password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def broker_url(self) -> str:
        return self.celery_broker_url or self.redis_url

    @computed_field  # type: ignore[prop-decorator]
    @property
    def result_backend(self) -> str:
        return self.celery_result_backend or self.redis_url

    #: HS256 keys shorter than this are rejected by production startup. RFC 7518
    #: §3.2 requires a key at least as long as the hash output.
    MIN_SIGNING_KEY_BYTES: ClassVar[int] = 32

    @computed_field  # type: ignore[prop-decorator]
    @property
    def token_signing_key(self) -> str:
        return self.jwt_secret_key or self.secret_key

    @model_validator(mode="after")
    def _check_production_secrets(self) -> Settings:
        if self.app_env is not AppEnv.PRODUCTION:
            return self
        key = self.jwt_secret_key or self.secret_key
        if key == "change-me-in-production" or len(key.encode()) < self.MIN_SIGNING_KEY_BYTES:
            raise ValueError(
                "Set JWT_SECRET_KEY (or SECRET_KEY) to a random string of at least "
                f"{self.MIN_SIGNING_KEY_BYTES} characters before running in production. "
                "A short or default key lets anyone mint a valid session token."
            )
        return self

    @computed_field  # type: ignore[prop-decorator]
    @property
    def unipile_base_url(self) -> str:
        """Normalised Unipile host, with or without a scheme in the DSN."""
        dsn = self.unipile_dsn.strip()
        if not dsn:
            return ""
        base = dsn if dsn.startswith("http") else f"https://{dsn}"
        return base.rstrip("/")

    @computed_field  # type: ignore[prop-decorator]
    @property
    def account_linking_enabled(self) -> bool:
        """Linking needs only Unipile credentials.

        ``notify_url`` is optional to Unipile, so a server with no public
        address still works: the connection is reconciled by reading the
        account back after the member returns, instead of being pushed to us.
        """
        return bool(self.unipile_dsn and self.unipile_api_key)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def unipile_webhook_enabled(self) -> bool:
        """Whether we can also be *told*, rather than only polling."""
        return bool(self.public_api_base_url and self.unipile_webhook_secret)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def is_production(self) -> bool:
        return self.app_env is AppEnv.PRODUCTION

    @computed_field  # type: ignore[prop-decorator]
    @property
    def is_local(self) -> bool:
        return self.app_env is AppEnv.LOCAL


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
