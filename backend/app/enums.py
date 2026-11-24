"""Domain enumerations shared by the database, workflow engine and API."""

from __future__ import annotations

from enum import StrEnum


class CampaignStatus(StrEnum):
    DRAFT = "DRAFT"
    READY = "READY"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    STOPPED = "STOPPED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class WorkflowState(StrEnum):
    DISCOVERING = "DISCOVERING"

    CANDIDATE_FOUND = "CANDIDATE_FOUND"
    EVALUATING_CANDIDATE = "EVALUATING_CANDIDATE"
    CANDIDATE_ACCEPTED = "CANDIDATE_ACCEPTED"
    CANDIDATE_REJECTED = "CANDIDATE_REJECTED"

    FINDING_POSTS = "FINDING_POSTS"

    POST_1_FOUND = "POST_1_FOUND"
    POST_1_LIKED = "POST_1_LIKED"

    POST_2_FOUND = "POST_2_FOUND"
    POST_2_LIKED = "POST_2_LIKED"

    POST_3_FOUND = "POST_3_FOUND"
    POST_3_EVALUATING = "POST_3_EVALUATING"
    POST_3_ACCEPTED = "POST_3_ACCEPTED"
    POST_3_REJECTED = "POST_3_REJECTED"
    POST_3_LIKED = "POST_3_LIKED"

    COMMENT_GENERATED = "COMMENT_GENERATED"
    COMMENT_PENDING_APPROVAL = "COMMENT_PENDING_APPROVAL"
    COMMENT_POSTED = "COMMENT_POSTED"
    COMMENT_REJECTED = "COMMENT_REJECTED"

    CONNECTION_SCHEDULED = "CONNECTION_SCHEDULED"
    WAITING_FOR_CONNECTION = "WAITING_FOR_CONNECTION"

    REVALIDATING = "REVALIDATING"

    CONNECTION_PENDING_APPROVAL = "CONNECTION_PENDING_APPROVAL"
    CONNECTION_READY = "CONNECTION_READY"
    CONNECTION_SENT = "CONNECTION_SENT"

    COMPLETED = "COMPLETED"
    SKIPPED = "SKIPPED"
    CANCELLED = "CANCELLED"
    FAILED = "FAILED"


#: States from which no further automatic progress is made.
TERMINAL_STATES: frozenset[WorkflowState] = frozenset(
    {
        WorkflowState.COMPLETED,
        WorkflowState.SKIPPED,
        WorkflowState.CANCELLED,
        WorkflowState.FAILED,
        WorkflowState.CANDIDATE_REJECTED,
    }
)

#: States where the engine stops and waits for a human decision.
APPROVAL_WAIT_STATES: frozenset[WorkflowState] = frozenset(
    {
        WorkflowState.COMMENT_PENDING_APPROVAL,
        WorkflowState.CONNECTION_PENDING_APPROVAL,
    }
)

#: States where the engine waits for the scheduler rather than a human.
TIMER_WAIT_STATES: frozenset[WorkflowState] = frozenset(
    {
        WorkflowState.CONNECTION_SCHEDULED,
        WorkflowState.WAITING_FOR_CONNECTION,
    }
)


class ActionType(StrEnum):
    LIKE_POST = "LIKE_POST"
    COMMENT_POST = "COMMENT_POST"
    SEND_CONNECTION = "SEND_CONNECTION"


class ActionStatus(StrEnum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    SKIPPED_DRY_RUN = "SKIPPED_DRY_RUN"


class ApprovalType(StrEnum):
    CANDIDATE = "CANDIDATE"
    COMMENT = "COMMENT"
    CONNECTION = "CONNECTION"


class ApprovalStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class ScheduledTaskType(StrEnum):
    CONNECTION = "CONNECTION"
    REVALIDATION = "REVALIDATION"
    ACTIVITY_MONITOR = "ACTIVITY_MONITOR"


class ScheduledTaskStatus(StrEnum):
    SCHEDULED = "SCHEDULED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"


class PostProcessingStatus(StrEnum):
    DISCOVERED = "DISCOVERED"
    ELIGIBLE = "ELIGIBLE"
    INELIGIBLE = "INELIGIBLE"
    EVALUATED = "EVALUATED"
    LIKED = "LIKED"
    COMMENTED = "COMMENTED"
    SKIPPED = "SKIPPED"
    #: Dry run reached this post but nothing was sent. Distinct from LIKED so
    #: the UI never claims an action that did not happen.
    WOULD_LIKE = "WOULD_LIKE"
    WOULD_COMMENT = "WOULD_COMMENT"


class PostType(StrEnum):
    TEXT = "TEXT"
    ARTICLE = "ARTICLE"
    IMAGE = "IMAGE"
    VIDEO = "VIDEO"
    POLL = "POLL"
    REPOST = "REPOST"
    JOB = "JOB"
    ADVERTISEMENT = "ADVERTISEMENT"
    OTHER = "OTHER"


#: Post types the engagement workflow is allowed to treat as eligible by default.
DEFAULT_ELIGIBLE_POST_TYPES: tuple[PostType, ...] = (
    PostType.TEXT,
    PostType.ARTICLE,
    PostType.IMAGE,
    PostType.VIDEO,
    PostType.POLL,
)


class CommentLength(StrEnum):
    SHORT = "SHORT"
    MEDIUM = "MEDIUM"
    LONG = "LONG"


class CommentStyle(StrEnum):
    PROFESSIONAL = "PROFESSIONAL"
    TECHNICAL = "TECHNICAL"
    CONVERSATIONAL = "CONVERSATIONAL"


class ConnectionMessageMode(StrEnum):
    NONE = "NONE"
    TEMPLATE = "TEMPLATE"
    AI_GENERATED = "AI_GENERATED"


class ApprovalMode(StrEnum):
    REQUIRED = "REQUIRED"
    AUTOMATIC = "AUTOMATIC"


class ConnectionStatus(StrEnum):
    NOT_CONNECTED = "NOT_CONNECTED"
    PENDING = "PENDING"
    CONNECTED = "CONNECTED"
    UNKNOWN = "UNKNOWN"


class CapabilitySupport(StrEnum):
    SUPPORTED = "SUPPORTED"
    UNSUPPORTED = "UNSUPPORTED"
    MANUAL_REQUIRED = "MANUAL_REQUIRED"


class PlatformCapability(StrEnum):
    SEARCH = "SEARCH"
    PROFILE_READ = "PROFILE_READ"
    POST_READ = "POST_READ"
    LIKE = "LIKE"
    COMMENT = "COMMENT"
    CONNECTION = "CONNECTION"


class AgentRunStatus(StrEnum):
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class LogLevel(StrEnum):
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"


class EventType(StrEnum):
    CANDIDATE_DISCOVERED = "candidate_discovered"
    CANDIDATE_EVALUATED = "candidate_evaluated"
    POST_FOUND = "post_found"
    POST_EVALUATED = "post_evaluated"
    ACTION_STARTED = "action_started"
    ACTION_COMPLETED = "action_completed"
    COMMENT_GENERATED = "comment_generated"
    APPROVAL_REQUIRED = "approval_required"
    CONNECTION_SCHEDULED = "connection_scheduled"
    CONNECTION_READY = "connection_ready"
    WORKFLOW_COMPLETED = "workflow_completed"
    WORKFLOW_FAILED = "workflow_failed"
    WORKFLOW_STATE_CHANGED = "workflow_state_changed"
    CAMPAIGN_STATUS_CHANGED = "campaign_status_changed"
    AGENT_LOG = "agent_log"


class UserRole(StrEnum):
    """Authorization role. ``ADMIN`` sees and manages every user's data."""

    ADMIN = "ADMIN"
    USER = "USER"


class UserStatus(StrEnum):
    """Lifecycle of an account, independent of its role.

    ``PENDING_VERIFICATION`` is only reachable when
    ``REQUIRE_EMAIL_VERIFICATION`` is on; with the flag off a new account is
    ``ACTIVE`` immediately.
    """

    PENDING_VERIFICATION = "PENDING_VERIFICATION"
    ACTIVE = "ACTIVE"
    DEACTIVATED = "DEACTIVATED"


class PlatformProvider(StrEnum):
    """A third-party identity a user can link to their account."""

    LINKEDIN = "LINKEDIN"


class PlatformAccountStatus(StrEnum):
    """Lifecycle of one linked platform identity."""

    PENDING = "PENDING"
    CONNECTED = "CONNECTED"
    DISCONNECTED = "DISCONNECTED"
    ERROR = "ERROR"
    WARNING = "WARNING"
    EXPIRED = "EXPIRED"

