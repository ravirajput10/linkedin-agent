"""Exercise every agent against a live LLM and report what came back.

    python -m scripts.check_llm                       # the configured provider
    python -m scripts.check_llm --model qwen3:32b     # override the local model
    python -m scripts.check_llm --compare qwen3:32b gpt-oss:120b llama3.3:70b

Each agent is given a realistic input and its output is validated against the
same Pydantic schema the workflow engine uses, so a pass here means the model is
genuinely usable — not merely reachable.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

# Real profiles carry emoji; the Windows console is cp1252 and would
# otherwise crash the whole run on one unprintable character.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.ai.agents import (
    CampaignParserAgent,
    CandidateEvaluatorAgent,
    CommentGeneratorAgent,
    ConnectionGeneratorAgent,
    PostEvaluatorAgent,
)
from app.ai.provider import LLMProvider
from app.ai.provider_factory import build_llm_provider, get_llm_provider
from app.config import LLMProviderName, get_settings
from app.database.models import (
    Campaign,
    CampaignCriteria,
    CampaignExclusion,
    Person,
    Post,
    PostEvaluation,
)
from app.enums import CommentLength, CommentStyle, PostType
from app.errors import AppError

INSTRUCTION = (
    "Find CTOs, VPs of Engineering and senior Java developers in SaaS companies "
    "in India who post about Java, Spring Boot, AI and microservices. Ignore "
    "recruitment posts, job advertisements, generic motivational content and "
    "spam. Like their first two relevant posts, evaluate the third with AI, and "
    "send a connection request after two days. Process up to 20 people per day."
)

#: A real post with a specific, arguable claim — the kind a good comment can
#: engage with. Weak models tend to answer it with generic praise.
POST_CONTENT = (
    "We finally moved our settlement pipeline off a shared Postgres table and "
    "onto Kafka with per-tenant partitions. The surprise was not throughput — "
    "it was that our p99 dropped because we stopped contending on row locks "
    "during the end-of-day batch. If your 'scaling problem' is really a locking "
    "problem, adding consumers will not save you."
)


def build_fixtures() -> tuple[Campaign, Person, Post, PostEvaluation]:
    """Detached ORM objects — no database needed."""
    campaign = Campaign(name="Java + AI CTO Outreach", instruction=INSTRUCTION)
    campaign.criteria = CampaignCriteria(
        job_titles=["CTO", "VP of Engineering", "Senior Java Developer"],
        industries=["SaaS", "Software"],
        locations=["India"],
        seniority_levels=["Executive", "Senior"],
        company_sizes=[],
        people_keywords=["Java", "AI", "microservices"],
        include_topics=["Java", "Spring Boot", "AI", "Microservices", "Architecture"],
        exclude_topics=["Recruitment", "Jobs", "Generic Motivation", "Spam"],
        include_keywords=[],
        exclude_keywords=["hiring"],
        post_types=["TEXT", "ARTICLE"],
        minimum_relevance_score=75,
        minimum_candidate_score=70,
        comment_length=CommentLength.SHORT,
        comment_style=CommentStyle.TECHNICAL,
    )
    campaign.exclusions = [
        CampaignExclusion(exclusion_type="company", value="Acme", reason="competitor")
    ]

    person = Person(
        platform="mock",
        external_id="mock-p-001",
        profile_url="https://example.invalid/in/ananya-rao",
        full_name="Ananya Rao",
        headline="CTO at Finflow · Scaling Java & event-driven platforms",
        job_title="CTO",
        company="Finflow",
        industry="SaaS",
        location="Bengaluru, India",
        about="Building payment infrastructure. Java, Spring Boot, Kafka, applied AI.",
    )

    post = Post(
        platform="mock",
        external_id="mock-post-001-a",
        person=person,
        content=POST_CONTENT,
        post_type=PostType.TEXT,
        published_at=datetime.now(UTC) - timedelta(hours=18),
        like_count=214,
        comment_count=31,
    )

    evaluation = PostEvaluation(
        post_id=1,
        campaign_id=1,
        eligible=True,
        relevance_score=91,
        topics=["Kafka", "Postgres", "Partitioning"],
        reason="Describes a concrete partitioning and row-lock trade-off.",
        risk_flags=[],
        agent_name="post_evaluator",
        prompt_version="v1",
        provider="n/a",
        model="n/a",
        input_hash="0" * 64,
    )
    return campaign, person, post, evaluation


@dataclass
class Check:
    agent: str
    ok: bool
    seconds: float
    detail: str
    tokens_in: int | None = None
    tokens_out: int | None = None


async def run_checks(provider: LLMProvider) -> list[Check]:
    campaign, person, post, evaluation = build_fixtures()

    cases: list[tuple[str, object, dict]] = [
        ("campaign_parser", CampaignParserAgent(provider=provider), {"instruction": INSTRUCTION}),
        (
            "candidate_evaluator",
            CandidateEvaluatorAgent(provider=provider),
            {"person": person, "campaign": campaign, "discovery_reason": "Matched CTO, SaaS, India"},
        ),
        (
            "post_evaluator",
            PostEvaluatorAgent(provider=provider),
            {"post": post, "person": person, "campaign": campaign},
        ),
        (
            "comment_generator",
            CommentGeneratorAgent(provider=provider),
            {"post": post, "person": person, "campaign": campaign, "evaluation": evaluation},
        ),
        (
            "connection_generator",
            ConnectionGeneratorAgent(provider=provider),
            {"person": person, "campaign": campaign, "reference_post": post},
        ),
    ]

    results: list[Check] = []
    for name, agent, kwargs in cases:
        started = time.perf_counter()
        try:
            result = await agent.run(**kwargs)  # type: ignore[attr-defined]
        except AppError as exc:
            results.append(
                Check(name, False, time.perf_counter() - started, f"{exc.code.value}: {exc.message}")
            )
            continue
        except Exception as exc:
            results.append(Check(name, False, time.perf_counter() - started, repr(exc)))
            continue

        elapsed = time.perf_counter() - started
        data = result.data
        match name:
            case "campaign_parser":
                detail = (
                    f"name={data.campaign_name!r} titles={data.target_people.job_titles} "
                    f"include={data.post_criteria.include_topics}"
                )
            case "candidate_evaluator":
                detail = f"match={data.match} score={data.score} — {data.reason[:110]}"
            case "post_evaluator":
                detail = (
                    f"eligible={data.eligible} score={data.relevance_score} "
                    f"topics={data.topics} — {data.reason[:110]}"
                )
            case "comment_generator":
                detail = f"({len(data.comment)} chars) {data.comment}"
            case _:
                detail = f"({len(data.message)} chars) {data.message}"

        if result.attempt_count > 1:
            detail = f"[took {result.attempt_count} attempts] {detail}"

        results.append(
            Check(
                name,
                True,
                elapsed,
                detail,
                result.usage.input_tokens,
                result.usage.output_tokens,
            )
        )
    return results


def report(label: str, results: list[Check]) -> bool:
    print(f"\n{'=' * 78}\n{label}\n{'=' * 78}")
    for check in results:
        mark = "PASS" if check.ok else "FAIL"
        tokens = (
            f"  {check.tokens_in}->{check.tokens_out} tok"
            if check.tokens_in is not None
            else ""
        )
        print(f"\n[{mark}] {check.agent}  ({check.seconds:.1f}s){tokens}")
        print(f"       {check.detail}")

    passed = sum(1 for c in results if c.ok)
    total_time = sum(c.seconds for c in results)
    print(f"\n  {passed}/{len(results)} agents passed in {total_time:.1f}s total")
    return passed == len(results)


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", help="Override the model (local provider only).")
    parser.add_argument(
        "--compare", nargs="+", metavar="MODEL", help="Run the same checks across several models."
    )
    args = parser.parse_args()

    settings = get_settings()
    print(f"provider={settings.llm_provider.value}  env={settings.app_env.value}")
    if settings.llm_provider is LLMProviderName.LOCAL:
        print(f"endpoint={settings.local_llm_base_url}  think={settings.local_llm_think}")

    models = args.compare or [args.model] if (args.compare or args.model) else [None]
    all_ok = True

    for model in models:
        if model is None:
            provider = get_llm_provider()
        else:
            provider = build_llm_provider(settings.model_copy(update={"local_llm_model": model}))
        try:
            results = await run_checks(provider)
            all_ok &= report(f"{provider.name} · {provider.model}", results)
        finally:
            await provider.aclose()

    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
