"""Exercise the configured platform adapter against the live API.

    python -m scripts.check_platform                         # the configured adapter
    python -m scripts.check_platform --adapter brightdata
    python -m scripts.check_platform --profile ananya-rao-123
    python -m scripts.check_platform --raw                   # dump the raw vendor JSON

Read-only by default. Nothing is liked, commented on or connected to unless you
pass --write, which needs an explicit target and still asks for confirmation.

Use ``--raw`` when a mapping looks wrong: it prints the vendor's untouched JSON
next to what the adapter made of it, which is how you find a renamed field.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

# Real profiles carry emoji; the Windows console is cp1252 and would
# otherwise crash the whole run on one unprintable character.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.config import PlatformAdapterName, get_settings
from app.enums import CapabilitySupport, PlatformCapability
from app.errors import AppError
from app.integrations.platform.base import SearchCriteria, SocialPlatformAdapter
from app.integrations.platform.factory import build_platform_adapter

#: A public figure who posts regularly, so a read check has something to find.
DEFAULT_PROFILE = "williamhgates"


def show_capabilities(adapter: SocialPlatformAdapter) -> None:
    print(f"\nadapter: {adapter.platform}")
    for capability, support in adapter.capabilities.items():
        mark = "OK  " if support is CapabilitySupport.SUPPORTED else "--  "
        note = adapter.capability_note(capability)
        print(f"  {mark}{capability.value:<14} {support.value}")
        if note and support is not CapabilitySupport.SUPPORTED:
            print(f"       {note}")


async def check_reads(adapter: SocialPlatformAdapter, profile_id: str, raw: bool) -> bool:
    ok = True

    if adapter.supports(PlatformCapability.SEARCH):
        print("\n--- search_people ---")
        started = time.perf_counter()
        try:
            result = await adapter.search_people(
                SearchCriteria(
                    job_titles=["CTO"], industries=["SaaS"], locations=["India"], limit=5
                )
            )
            print(f"  {len(result.people)} people in {time.perf_counter() - started:.1f}s")
            for person in result.people[:3]:
                print(f"    {person.full_name:<28} {person.job_title or '-':<22} {person.company or '-'}")
            if result.people and not result.people[0].full_name:
                print("  WARNING: names came back empty — the mapping needs correcting")
                ok = False
        except AppError as exc:
            print(f"  FAILED {exc.code.value}: {exc.message}")
            ok = False
    else:
        print("\n--- search_people: not supported by this adapter, skipping ---")

    print("\n--- get_profile ---")
    started = time.perf_counter()
    try:
        profile = await adapter.get_profile(profile_id)
        print(f"  {time.perf_counter() - started:.1f}s")
        for field in ("external_id", "full_name", "headline", "job_title", "company", "location"):
            value = getattr(profile, field)
            flag = "" if value else "   <- empty, check the mapping"
            print(f"    {field:<14} {value!r}{flag}")
        if raw:
            print("  raw:", json.dumps(profile.model_dump(mode="json"), indent=2)[:1200])
    except AppError as exc:
        print(f"  FAILED {exc.code.value}: {exc.message}")
        ok = False

    print("\n--- get_posts ---")
    started = time.perf_counter()
    try:
        posts = await adapter.get_posts(profile_id, limit=5)
        print(f"  {len(posts)} posts in {time.perf_counter() - started:.1f}s")
        for post in posts[:3]:
            stamp = post.published_at.date().isoformat() if post.published_at else "no date"
            print(f"    [{stamp}] {post.post_type.value:<8} likes={post.like_count} "
                  f"comments={post.comment_count}")
            print(f"      {post.content[:140]!r}")
        if posts and not any(p.content.strip() for p in posts):
            print("  WARNING: every post body is empty — post text is the one thing")
            print("           this integration exists for, so the mapping is wrong")
            ok = False
        if raw and posts:
            print("  raw:", json.dumps(posts[0].model_dump(mode="json"), indent=2)[:1200])
    except AppError as exc:
        print(f"  FAILED {exc.code.value}: {exc.message}")
        ok = False

    return ok


async def check_writes(adapter: SocialPlatformAdapter, post_id: str | None, person_id: str | None) -> None:
    print("\n--- WRITE CHECKS ---")
    print("  These perform real actions on a real account.")
    if post_id:
        confirm = input(f"  Like post {post_id}? [y/N] ").strip().lower()
        if confirm == "y":
            try:
                outcome = await adapter.like_post(post_id)
                print(f"    {outcome.success} {outcome.detail}")
            except AppError as exc:
                print(f"    FAILED {exc.code.value}: {exc.message}")
    if person_id:
        confirm = input(f"  Send a connection request to {person_id}? [y/N] ").strip().lower()
        if confirm == "y":
            try:
                outcome = await adapter.send_connection(
                    person_id, "Hi, enjoyed your recent post and would be glad to connect."
                )
                print(f"    {outcome.success} {outcome.detail}")
            except AppError as exc:
                print(f"    FAILED {exc.code.value}: {exc.message}")


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adapter", choices=[a.value for a in PlatformAdapterName])
    parser.add_argument("--profile", default=DEFAULT_PROFILE, help="profile id or URL to read")
    parser.add_argument("--raw", action="store_true", help="dump mapped objects in full")
    parser.add_argument("--write", action="store_true", help="also run write checks")
    parser.add_argument("--like-post", help="post id to like, with --write")
    parser.add_argument("--connect-person", help="person id to invite, with --write")
    args = parser.parse_args()

    settings = get_settings()
    if args.adapter:
        settings = settings.model_copy(
            update={"platform_adapter": PlatformAdapterName(args.adapter)}
        )

    print(f"env={settings.app_env.value}  adapter={settings.platform_adapter.value}")
    try:
        adapter = build_platform_adapter(settings)
    except AppError as exc:
        print(f"\nCould not build the adapter: {exc.message}")
        return 1

    try:
        show_capabilities(adapter)
        ok = await check_reads(adapter, args.profile, args.raw)
        if args.write:
            await check_writes(adapter, args.like_post, args.connect_person)
    finally:
        await adapter.aclose()

    print("\n" + ("All read checks passed." if ok else "Some checks failed — see above."))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
