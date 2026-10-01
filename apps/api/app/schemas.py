from typing import Annotated, Literal

from pydantic import BaseModel, Field


# ---------- planning ----------
Facing = Literal["N", "E", "S", "W", "NE", "NW", "SE", "SW"]
# An [x, y] vertex in metres; bounded so a payload can't stall the solver.
Vertex = Annotated[list[Annotated[float, Field(ge=-1000, le=1000)]], Field(min_length=2, max_length=2)]


class Requirements(BaseModel):
    plotWidth: float = Field(gt=2, le=200)
    plotDepth: float = Field(gt=2, le=200)
    facing: Facing
    floors: int = Field(ge=1, le=4)
    plotPolygon: list[Vertex] | None = Field(default=None, min_length=3, max_length=100)
    plotUse: Literal["balanced", "max"] | None = None
    bedrooms: int = Field(ge=1, le=10)
    bathrooms: int = Field(ge=1, le=10)
    parking: int = Field(ge=0, le=3)
    balconies: int = Field(ge=0, le=8)
    vastu: bool = True
    garden: bool = False
    pool: bool = False
    homeOffice: bool = False
    budget: Literal["economy", "standard", "premium", "luxury"] = "standard"
    style: Literal["modern", "contemporary", "traditional", "minimal"] = "modern"
    luxury: int = Field(ge=1, le=5, default=3)


class PlanRoomIn(BaseModel):
    label: str = Field(max_length=60)
    type: str = Field(max_length=30)
    w: float = Field(ge=0, le=200)
    h: float = Field(ge=0, le=200)


class PlanFloorMetricsIn(BaseModel):
    vastuScore: int = Field(ge=0, le=100)


class PlanFloorIn(BaseModel):
    name: str = Field(max_length=40)
    metrics: PlanFloorMetricsIn
    rooms: list[PlanRoomIn] = Field(max_length=80)


class PlanValidationIn(BaseModel):
    ok: bool = True
    errors: list[str] = Field(default_factory=list, max_length=40)


class PlanIn(BaseModel):
    """The plan the web app generated (only what the critique needs)."""
    floors: list[PlanFloorIn] = Field(min_length=1, max_length=5)
    validation: PlanValidationIn | None = None
    suggestions: list[dict] = Field(default_factory=list, max_length=20)


class SuggestionsIn(BaseModel):
    requirements: Requirements
    plan: PlanIn
