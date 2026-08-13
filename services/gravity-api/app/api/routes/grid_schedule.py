"""
Scheduled grid refresh endpoints (roadmap P2.2).

POST /v1/grid/run-now        — re-run one saved grid + email its diff (manual / verify)
POST /v1/grid/run-scheduled  — run all due schedules (called by the in-process loop or an external cron)

Both require the internal API key (X-API-Key: deep-research-internal).
"""

from __future__ import annotations

import structlog
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.middleware.auth import require_auth
from app.core.grid_scheduler import run_grid_now, run_due_schedules

logger = structlog.get_logger()
router = APIRouter(prefix="/v1/grid", tags=["grid-schedule"])


class RunNowRequest(BaseModel):
    grid_run_id: str = Field(..., description="lib_grid_runs.id of the saved grid to re-run")
    email: str = Field(..., description="digest recipient")
    always_email: bool = Field(True, description="email even when nothing changed")


@router.post("/run-now")
async def run_now(req: RunNowRequest, auth: dict = Depends(require_auth)):
    # `scheduled_grids` is off entirely on the free tier, so this is the flag form
    # of the gate: 402 naming the plan rather than running the grid. PL-6.
    from app.billing.enforce import enforce
    await enforce("scheduled_grids", auth.get("tier", "free"), auth["user_id"])
    return await run_grid_now(req.grid_run_id, req.email, req.always_email)


@router.post("/run-scheduled")
async def run_scheduled(schedule_id: str | None = None, auth: dict = Depends(require_auth)):
    return await run_due_schedules(force_id=schedule_id)
