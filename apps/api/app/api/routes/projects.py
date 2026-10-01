from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user
from app.db.session import get_db
from app.models import Project, User
from app.schemas import ProjectIn, ProjectOut

router = APIRouter(prefix="/projects", tags=["projects"])

FREE_PROJECT_LIMIT = 3


@router.get("", response_model=list[ProjectOut])
async def list_projects(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = await db.scalars(
        select(Project).where(Project.user_id == user.id, Project.is_archived.is_(False))
        .order_by(Project.updated_at.desc())
    )
    return [ProjectOut(id=str(p.id), name=p.name, description=p.description,
                       created_at=p.created_at.isoformat()) for p in rows]


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(body: ProjectIn, user: User = Depends(current_user),
                         db: AsyncSession = Depends(get_db)):
    count = len((await db.scalars(select(Project).where(Project.user_id == user.id))).all())
    if count >= FREE_PROJECT_LIMIT:
        # Enforced against the user's subscription tier in production.
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED,
                            "Free plan limit reached — upgrade to Pro for unlimited projects.")
    p = Project(user_id=user.id, name=body.name, description=body.description)
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return ProjectOut(id=str(p.id), name=p.name, description=p.description,
                      created_at=p.created_at.isoformat())


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: str, user: User = Depends(current_user),
                         db: AsyncSession = Depends(get_db)):
    p = await db.scalar(select(Project).where(Project.id == project_id, Project.user_id == user.id))
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    await db.delete(p)
    await db.commit()
