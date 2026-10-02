from fastapi import APIRouter, Depends, Request

from app.api.deps import current_user
from app.core.rate_limit import limiter
from app.core.supabase_auth import AuthUser
from app.schemas import SuggestionsIn
from app.services.llm import critique_plan

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/suggestions")
@limiter.limit("10/minute")
async def suggestions(request: Request, body: SuggestionsIn, user: AuthUser = Depends(current_user)) -> dict:
    """AI design critique for a plan generated in the browser.

    The floor-plan engine runs client-side (apps/web/src/lib/floorplan); the
    client posts the plan it shows the user. The engine's own suggestions are
    echoed back, and Claude's critique (via Vertex) is appended when configured.
    """
    req = body.requirements.model_dump()
    plan = body.plan.model_dump()
    tips: list[dict] = [t for t in plan["suggestions"] if isinstance(t, dict) and "message" in t]
    ai_tips = await critique_plan(plan, req)
    if ai_tips:
        tips.extend(ai_tips)
    return {"suggestions": tips, "ai": ai_tips is not None}
