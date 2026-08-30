"""
The skill routes, and the status codes an abstention gets.

The rule this pins: an abstention is a 200. `insufficient_data`,
`ambiguous_entity` and `conflicting_evidence` are correct answers that happen
to be "no", and giving them a 4xx makes "the evidence does not exist"
indistinguishable to a client from "you called the wrong URL". That conflation
is exactly what the old sentiment endpoint shipped — 404 for every company —
and it is what made a dead surface look like a routing problem rather than a
missing capability.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import skills as skills_route
from app.core.skills.contract import SkillResult, SkillStatus


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(skills_route.router, prefix="/v1")
    return TestClient(app)


class Stub:
    SKILL = "company"

    def __init__(self, status):
        self.status = status

    async def run(self, request):
        return SkillResult(skill=request.skill, status=self.status,
                           limitations=["stubbed"])

    async def capability(self, request, resolver=None):
        from app.core.skills.contract import SkillCapability

        return SkillCapability(skill=request.skill, entity_status="resolved",
                               executable=True)


def test_the_skill_list_names_both_skills(client):
    body = client.get("/v1/skills").json()
    assert "company" in body["skills"]
    assert "sentiment" in body["skills"]
    assert "insufficient_data" in body["statuses"]


@pytest.mark.parametrize("status,code", [
    (SkillStatus.SUCCESS, 200),
    (SkillStatus.PARTIAL, 200),
    (SkillStatus.INSUFFICIENT_DATA, 200),
    (SkillStatus.AMBIGUOUS_ENTITY, 200),
    (SkillStatus.CONFLICTING_EVIDENCE, 200),
    (SkillStatus.UNSUPPORTED_OPERATION, 501),
    (SkillStatus.ERROR, 503),
])
def test_every_abstention_is_a_two_hundred(client, monkeypatch, status, code):
    monkeypatch.setitem(skills_route.SKILLS, "company", Stub(status))
    r = client.get("/v1/skills/company", params={"company": "CPRT"})
    assert r.status_code == code
    assert r.json()["status"] == status.value


def test_an_unknown_skill_is_a_four_oh_four_and_says_which(client):
    r = client.get("/v1/skills/nonsense", params={"company": "CPRT"})
    assert r.status_code == 404
    assert r.json()["status"] == "unsupported_operation"
    assert "nonsense" in r.json()["limitations"][0]


def test_capability_answers_before_the_skill_runs(client, monkeypatch):
    monkeypatch.setitem(skills_route.SKILLS, "company", Stub(SkillStatus.SUCCESS))
    body = client.get("/v1/skills/company/capability",
                      params={"company": "CPRT"}).json()
    assert body["executable"] is True
    assert body["entity_status"] == "resolved"


def test_capability_for_an_unknown_skill_is_not_executable(client):
    body = client.get("/v1/skills/nonsense/capability",
                      params={"company": "CPRT"}).json()
    assert body["executable"] is False


def test_the_company_parameter_is_required(client):
    assert client.get("/v1/skills/company").status_code == 422


def test_the_response_carries_the_whole_contract(client, monkeypatch):
    monkeypatch.setitem(skills_route.SKILLS, "company", Stub(SkillStatus.SUCCESS))
    body = client.get("/v1/skills/company", params={"company": "CPRT"}).json()
    for key in ("skill", "status", "entities", "period", "claims", "data",
                "citations", "verification", "limitations", "channels"):
        assert key in body, key


# ── The plan endpoint ─────────────────────────────────────────────────────


def test_the_plan_endpoint_answers_without_a_company_or_a_network(client):
    r = client.get("/v1/skills/_/plan", params={"q": "Apple revenue FY2025"})
    assert r.status_code == 200
    d = r.json()
    assert d["intent"] == "lookup"
    assert [m["key"] for m in d["metrics"]] == ["revenue"]
    assert d["period"] == "FY2025"


def test_the_plan_endpoint_marks_a_set_question_as_a_ranking(client):
    r = client.get("/v1/skills/_/plan",
                   params={"q": "Which S&P 500 companies mentioned tariff risk?"})
    d = r.json()
    assert d["intent"] == "ranking"
    assert d["scope"]["is_set_question"] is True
    assert d["scope"]["size_hint"] == 503


def test_the_plan_endpoint_reports_a_margin_change_in_points(client):
    r = client.get("/v1/skills/_/plan",
                   params={"q": "NVIDIA operating margin year-over-year"})
    assert r.json()["change_unit"] == "pp"


def test_the_plan_endpoint_rejects_an_empty_question(client):
    assert client.get("/v1/skills/_/plan", params={"q": ""}).status_code == 422


def test_the_plan_endpoint_is_stable_across_repeated_calls(client):
    q = {"q": "Compare Apple and Microsoft free cash flow"}
    first = client.get("/v1/skills/_/plan", params=q).json()
    for _ in range(5):
        assert client.get("/v1/skills/_/plan", params=q).json() == first
