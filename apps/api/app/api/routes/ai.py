import time

from fastapi import APIRouter, Depends, Request

from app.api.deps import current_user
from app.core.rate_limit import limiter
from app.models import User
from app.schemas import GenerateIn
from app.services.floorplan import generate_plan, to_flat
from app.services.llm import critique_plan

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/generate")
@limiter.limit("30/minute")
async def generate(request: Request, body: GenerateIn, user: User = Depends(current_user)) -> dict:
    """Generate a 2D floor-plan from requirements using the geometric engine.

    Stateless and key-free — returns the full PlanResult (rooms, doors,
    windows and walls per floor) plus a flat { rooms, doors, windows, walls }
    view per floor. In production this is also persisted to `floor_plans`.
    """
    start = time.perf_counter()
    plan = generate_plan(body.requirements.model_dump())
    plan["engine"] = "architectural-v2"
    plan["flat"] = [to_flat(f) for f in plan["floors"]]
    plan["durationMs"] = round((time.perf_counter() - start) * 1000, 2)
    return plan


@router.post("/suggestions")
@limiter.limit("10/minute")
async def suggestions(request: Request, body: GenerateIn, user: User = Depends(current_user)) -> dict:
    """Optimisation hints for a generated plan.

    Always returns the engine's deterministic suggestions (the same ones the
    web planner shows). When Claude (via Vertex) is configured, AI design
    critique is appended; if the model call fails or is unconfigured, the
    baseline is returned unchanged.
    """
    req = body.requirements.model_dump()
    plan = generate_plan(req)
    tips: list[dict] = list(plan["suggestions"])

    ai_tips = await critique_plan(plan, req)
    if ai_tips:
        tips.extend(ai_tips)

    return {"suggestions": tips, "ai": ai_tips is not None}
