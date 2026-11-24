"""Password hashing.

bcrypt is used directly rather than through passlib: passlib 1.7.4 probes
``bcrypt.__about__``, which bcrypt 4.x removed, and the resulting traceback is
logged on every process start even though the hash still succeeds.

bcrypt silently ignores anything past 72 bytes of input, which would make a long
passphrase no stronger than its first 72 bytes. Hashing the password to a fixed
44-byte digest first removes the limit entirely, so the full passphrase counts.
"""

from __future__ import annotations

import base64
import hashlib
import secrets

import bcrypt

#: Work factor. 12 is roughly 250ms on commodity hardware in 2025.
BCRYPT_ROUNDS = 12


def _digest(password: str) -> bytes:
    return base64.b64encode(hashlib.sha256(password.encode("utf-8")).digest())


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_digest(password), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("ascii")


def verify_password(password: str, hashed: str) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(_digest(password), hashed.encode("ascii"))
    except (ValueError, TypeError):
        # A malformed stored hash must read as "wrong password", never as a crash.
        return False


def generate_token(length: int = 32) -> str:
    """A URL-safe random token for email verification and password resets."""
    return secrets.token_urlsafe(length)


def hash_token(token: str) -> str:
    """Tokens are stored as digests so a database leak does not yield live tokens."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
