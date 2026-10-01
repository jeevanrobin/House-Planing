from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user
from app.db.session import get_db
from app.models import Plot, Project, User
from app.schemas import PlotIn, PlotOut
from app.services.geo import compute

router = APIRouter(tags=["plots"])


def _serialize(p: Plot) -> PlotOut:
    return PlotOut(
        id=str(p.id), project_id=str(p.project_id), boundary=p.boundary,
        area_sqft=p.area_sqft, area_sqm=p.area_sqm, perimeter_m=p.perimeter_m,
        length_m=p.length_m, width_m=p.width_m, facing=p.facing,
        latitude=p.latitude, longitude=p.longitude, address=p.address,
        city=p.city, state=p.state, country=p.country,
        created_at=p.created_at.isoformat(),
    )


async def _owned_project(db: AsyncSession, project_id: str, user: User) -> Project:
    proj = await db.scalar(
        select(Project).where(Project.id == project_id, Project.user_id == user.id)
    )
    if not proj:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return proj


@router.post("/plots", response_model=PlotOut, status_code=status.HTTP_201_CREATED)
async def save_plot(body: PlotIn, user: User = Depends(current_user),
                    db: AsyncSession = Depends(get_db)):
    await _owned_project(db, body.project_id, user)
    # Authoritative server-side validation + recompute (never trust client areas).
    try:
        m = compute(body.boundary)
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))

    plot = Plot(
        project_id=body.project_id, user_id=user.id, boundary=body.boundary,
        facing=body.facing or m["facing"], address=body.address,
        city=body.city, state=body.state, country=body.country,
        **{k: m[k] for k in ("area_sqft", "area_sqm", "perimeter_m",
                             "length_m", "width_m", "latitude", "longitude")},
    )
    db.add(plot)
    await db.commit()
    await db.refresh(plot)
    return _serialize(plot)


@router.get("/projects/{project_id}/plots", response_model=list[PlotOut])
async def list_plots(project_id: str, user: User = Depends(current_user),
                     db: AsyncSession = Depends(get_db)):
    await _owned_project(db, project_id, user)
    rows = await db.scalars(
        select(Plot).where(Plot.project_id == project_id).order_by(Plot.created_at.desc())
    )
    return [_serialize(p) for p in rows]


@router.get("/plots/{plot_id}", response_model=PlotOut)
async def get_plot(plot_id: str, user: User = Depends(current_user),
                   db: AsyncSession = Depends(get_db)):
    p = await db.scalar(select(Plot).where(Plot.id == plot_id, Plot.user_id == user.id))
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plot not found")
    return _serialize(p)


@router.delete("/plots/{plot_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plot(plot_id: str, user: User = Depends(current_user),
                      db: AsyncSession = Depends(get_db)):
    p = await db.scalar(select(Plot).where(Plot.id == plot_id, Plot.user_id == user.id))
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plot not found")
    await db.delete(p)
    await db.commit()
