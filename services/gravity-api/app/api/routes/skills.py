"""
The universal skill surface: one shape in, one shape out, any registrant.

`GET /v1/skills/{skill}` runs a skill for a company mention.
`GET /v1/skills/{skill}/capability` says whether it could run, before it does.
`GET /v1/skills` lists what exists.

Why these are new routes rather than changes to `/v1/analytics/sentiment/{ticker}`:
that endpoint reads a cache keyed on a `document_id` the caller must already
hold, and answers 404 otherwise. It is a cache reader, and it is correct as
one. What was missing was any path from a company to a sentiment reading, for
any company at all. The old route keeps working; this one is the answer to the
question the product actually asks.

Nothing here is company-scoped. The mention goes to the one entity layer, which
indexes SEC's whole ticker file, and the skills read filings at query time. A
registrant nobody has heard of takes exactly the same path as NVIDIA.
"""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.core.skills import company_skill, sentiment_skill
from app.core.skills.contract import SkillRequest, SkillStatus

router = APIRouter(prefix="/skills", tags=["Skills"])

SKILLS = {
    company_skill.SKILL: company_skill,
    sentiment_skill.SKILL: sentiment_skill,
}

#: HTTP status per skill status. Every one of these is 200 except the two that
#: are genuinely about the request or the server. An abstention is a correct
#: answer that happens to be "no", and returning 404 for it would make
#: "insufficient evidence" indistinguishable from "route not found" — which is
#: the exact conflation the old sentiment endpoint made.
_HTTP = {
    SkillStatus.SUCCESS: 200,
    SkillStatus.PARTIAL: 200,
    SkillStatus.INSUFFICIENT_DATA: 200,
    SkillStatus.AMBIGUOUS_ENTITY: 200,
    SkillStatus.CONFLICTING_EVIDENCE: 200,
    SkillStatus.UNSUPPORTED_OPERATION: 501,
    SkillStatus.ERROR: 503,
}


@router.get("")
async def list_skills():
    """Every skill, and the contract it answers in."""
    return {
        "skills": sorted(SKILLS),
        "statuses": [s.value for s in SkillStatus],
        "note": (
            "Skills are entity-driven, not company-scoped. Any mention that "
            "resolves to an SEC registrant is executable."
        ),
    }


@router.get("/{skill}/capability")
async def skill_capability(
    skill: str,
    company: str = Query(..., description="Ticker, company name, or legal name"),
    period: str = Query("latest"),
):
    mod = SKILLS.get(skill)
    if mod is None:
        return {"skill": skill, "executable": False, "error": "unknown skill"}
    cap = await mod.capability(
        SkillRequest(skill=skill, entities=[company], period=period)
    )
    return cap.as_dict()


@router.get("/{skill}")
async def run_skill(
    skill: str,
    company: str = Query(..., description="Ticker, company name, or legal name"),
    period: str = Query("latest"),
    query: str = Query(""),
):
    from fastapi.responses import JSONResponse

    mod = SKILLS.get(skill)
    if mod is None:
        return JSONResponse(
            status_code=404,
            content={"skill": skill, "status": "unsupported_operation",
                     "limitations": [f"No skill named {skill!r}."]},
        )
    result = await mod.run(
        SkillRequest(skill=skill, entities=[company], period=period, query=query)
    )
    return JSONResponse(
        status_code=_HTTP.get(result.status, 200), content=result.as_dict()
    )


@router.get("/_/plan")
async def plan(q: str = Query(..., min_length=1, description="A finance question")):
    """
    What a question asks for, before anything is retrieved.

    Exposed because the plan is the contract between the question and the
    answer, and a contract that can only be inspected by reading model output
    is not one. Same question in, same plan out, with no network call — so this
    is also the cheapest way to see why a question routed the way it did.
    """
    from app.core.finance.query_plan import plan_query

    return plan_query(q).as_dict()
