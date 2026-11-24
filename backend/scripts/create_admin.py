"""Create or promote an administrator.

    python -m scripts.create_admin
    python -m scripts.create_admin --email you@example.com
    python -m scripts.create_admin --email you@example.com --promote

Without ``--password`` the password is read from a hidden prompt, so it never
lands in your shell history. ``--promote`` turns an existing account into an
administrator instead of creating one.
"""

from __future__ import annotations

import argparse
import getpass
import sys

from sqlalchemy import func, select
from sqlalchemy import update as sa_update

from app.config import settings
from app.database import SessionLocal
from app.database.models import Campaign, User
from app.enums import UserRole, UserStatus
from app.security import hash_password
from app.services import auth_service


def _prompt_password() -> str:
    first = getpass.getpass("Password: ")
    if len(first) < settings.min_password_length:
        sys.exit(f"Password must be at least {settings.min_password_length} characters.")
    if first != getpass.getpass("Confirm password: "):
        sys.exit("Passwords did not match.")
    return first


def main() -> int:
    parser = argparse.ArgumentParser(description="Create or promote an administrator.")
    parser.add_argument("--email", help="Administrator email address.")
    parser.add_argument("--password", help="Avoid: this ends up in your shell history.")
    parser.add_argument("--name", default="Administrator", help="Full name.")
    parser.add_argument(
        "--promote",
        action="store_true",
        help="Promote an existing account rather than creating one.",
    )
    parser.add_argument(
        "--reset-password",
        action="store_true",
        help="With --promote, also set a new password.",
    )
    parser.add_argument(
        "--claim-orphans",
        action="store_true",
        help=(
            "Assign campaigns that have no owner to this account. Campaigns "
            "created before accounts existed are unowned, so nobody can see "
            "them until someone claims them."
        ),
    )
    args = parser.parse_args()

    email = (args.email or input("Email: ")).strip().lower()
    if not email or "@" not in email:
        return self_exit("A valid email address is required.")

    with SessionLocal() as session:
        existing = auth_service.find_by_email(session, email)

        if existing is not None and not args.promote:
            return self_exit(
                f"{email} already exists. Re-run with --promote to make it an administrator."
            )

        if existing is not None:
            existing.role = UserRole.ADMIN
            existing.is_active = True
            existing.status = UserStatus.ACTIVE
            existing.email_verified = True
            existing.deactivated_at = None
            existing.deactivated_reason = None
            if args.reset_password:
                password = args.password or _prompt_password()
                existing.hashed_password = hash_password(password)
                auth_service.revoke_all_tokens(session, existing.id, "admin")
            claimed = _claim_orphans(session, existing.id) if args.claim_orphans else 0
            session.commit()
            print(f"Promoted {email} to administrator.")
            if claimed:
                print(f"Assigned {claimed} unowned campaign(s) to {email}.")
            return 0

        password = args.password or _prompt_password()
        if len(password) < settings.min_password_length:
            return self_exit(
                f"Password must be at least {settings.min_password_length} characters."
            )

        user, _ = auth_service.create_user(
            session,
            email=email,
            password=password,
            full_name=args.name,
            role=UserRole.ADMIN,
            email_verified=True,
        )
        claimed = _claim_orphans(session, user.id) if args.claim_orphans else 0
        session.commit()

        total = session.scalar(select(func.count()).select_from(User)) or 0
        print(f"Created administrator {user.email} (id={user.id}). {total} user(s) total.")
        if claimed:
            print(f"Assigned {claimed} unowned campaign(s) to {user.email}.")
        elif not args.claim_orphans:
            orphans = (
                session.scalar(
                    select(func.count()).select_from(Campaign).where(Campaign.owner_id.is_(None))
                )
                or 0
            )
            if orphans:
                print(
                    f"Note: {orphans} campaign(s) have no owner and are invisible to "
                    "every account. Re-run with --promote --claim-orphans to take them."
                )
        return 0


def _claim_orphans(session, user_id: int) -> int:
    """Hand unowned campaigns to a user.

    Campaigns created before accounts existed have ``owner_id IS NULL``, and the
    per-user scoping means nobody can see them. This is the way back.
    """
    result = session.execute(
        sa_update(Campaign).where(Campaign.owner_id.is_(None)).values(owner_id=user_id)
    )
    return int(result.rowcount or 0)


def self_exit(message: str) -> int:
    print(message, file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
