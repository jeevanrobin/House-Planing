from typing import Annotated, Literal
from pydantic import BaseModel, EmailStr, Field


# ---------- auth ----------
class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str | None = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class OtpRequestIn(BaseModel):
    email: EmailStr
    purpose: Literal["login", "verify_email", "reset"] = "login"


class OtpVerifyIn(BaseModel):
    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")
    purpose: Literal["login", "verify_email", "reset"] = "login"


class GoogleIn(BaseModel):
    id_token: str = Field(min_length=1, max_length=4096)


class RefreshIn(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=4096)


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: str
    email: EmailStr
    full_name: str | None = None
    role: str
    provider: str


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


class GenerateIn(BaseModel):
    requirements: Requirements
    project_id: str | None = None


# ---------- plots ----------
class PlotIn(BaseModel):
    project_id: str
    boundary: dict  # GeoJSON Polygon
    facing: Facing | None = None  # user override; else derived server-side
    address: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None


class PlotOut(BaseModel):
    id: str
    project_id: str
    boundary: dict
    area_sqft: float
    area_sqm: float
    perimeter_m: float
    length_m: float | None = None
    width_m: float | None = None
    facing: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    created_at: str


# ---------- projects ----------
class ProjectIn(BaseModel):
    name: str
    description: str | None = None


class ProjectOut(BaseModel):
    id: str
    name: str
    description: str | None = None
    created_at: str
