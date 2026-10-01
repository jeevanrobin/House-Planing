import time

from fastapi import APIRouter

from app.schemas import GenerateIn
from app.services.floorplan import generate_plan, to_flat
from app.services.llm import critique_plan

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/generate")
async def generate(body: GenerateIn) -> dict:
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
async def suggestions(body: GenerateIn) -> dict:
    """Optimisation hints for a generated plan.

    Always returns the deterministic baseline tips. When Claude (via Vertex) is
    configured, AI design critique is appended; if the model call fails or is
    unconfigured, the baseline is returned unchanged.
    """
    req = body.requirements.model_dump()
    plan = generate_plan(req)
    tips: list[dict] = []
    score = plan["summary"]["vastuScore"]
    tips.append({
        "kind": "vastu",
        "severity": "good" if score >= 75 else "warn",
        "message": f"Vastu compliance {score}/100.",
    })
    tips.append({
        "kind": "space",
        "severity": "info",
        "message": f"Built-up area {plan['summary']['builtUpArea']} m² across {plan['summary']['floors']} floor(s).",
    })

    ai_tips = await critique_plan(plan, req)
    if ai_tips:
        tips.extend(ai_tips)

    return {"suggestions": tips, "ai": ai_tips is not None}
