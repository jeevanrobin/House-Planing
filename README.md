# AI Plot Planner

Premium SaaS that turns a **map-selected plot + your requirements** into intelligent,
Vastu-aware **2D house plans** — instantly, in the browser.

> **Status: foundation milestone.** The frontend, design system, AI planning engine,
> 2D plan generator and interactive editor are **built and working today**. Auth,
> Google Maps, payments and async workers are **scaffolded** with a complete schema,
> typed contracts and infra, ready to be wired in subsequent milestones.

---

## Monorepo layout

```
.
├── apps/
│   ├── web/                 # Next.js 15 · React 19 · TS · Tailwind · Framer Motion
│   │   └── src/
│   │       ├── app/         # landing · /planner · /dashboard
│   │       ├── components/  # UI primitives, planner wizard, floor-plan canvas
│   │       └── lib/floorplan/   # ⭐ the AI planning engine (TypeScript)
│   └── api/                 # FastAPI · SQLAlchemy 2 · Pydantic v2
│       ├── app/
│       │   ├── services/floorplan.py   # ⭐ engine, ported to Python
│       │   ├── api/routes/  # auth · projects · ai
│       │   └── models.py    # ORM models
│       └── db/schema.sql    # complete PostgreSQL schema
├── docker-compose.yml       # web · api · postgres · redis
├── .github/workflows/ci.yml # typecheck · lint · build · engine tests · docker
└── docs/ARCHITECTURE.md     # design system, scaling, AWS deployment
```

## What actually works right now

| Module | State | Notes |
| --- | --- | --- |
| Landing page | ✅ | Hero, features, pricing, testimonials, FAQ, CTA — dark/light, glass |
| Design system | ✅ | Tailwind tokens, glassmorphism, Shadcn-style primitives, theming |
| Requirement wizard | ✅ | 4 steps, animated, fully typed |
| **AI planning engine** | ✅ | Architectural solver: adjacency clusters (bedroom+ensuite), wall network, Vastu assignment pass — offline, **no API key** |
| **2D plan generator** | ✅ | Architectural render: wall poché, door swings, window symbols, dimensions + area; flat `{rooms,doors,windows,walls}` export |
| **Interactive editor** | ✅ | Drag, resize, retype rooms, undo/redo |
| Exports | ✅ PNG/SVG · ⏳ PDF/DXF | Client-side raster/vector now; CAD later |
| Dashboard | ✅ (mock data) | Projects, stats, subscription shell |
| Backend API | 🟡 scaffold | `/ai/generate` is live & real (requires login, rate-limited); auth/projects need a DB |
| Auth (email/OTP/Google/JWT) | 🟡 scaffold | Flows + token issuance written; Google verify is a stub |
| **Plot selection module** | ✅ | Google Maps draw/edit/delete + area/perimeter/length/width, facing, geocoding, validation. Offline fallback editor when no key |
| Payments / Admin | ⏳ | Schema ready |

## Quick start

### Frontend (works standalone, no keys)
```bash
cd apps/web
npm install          # or: pnpm install from the repo root
npm run dev          # http://localhost:3100  → try /planner
```

### Backend
```bash
cd apps/api
python -m venv .venv && . .venv/Scripts/activate   # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload                       # http://localhost:8000/docs
```

`/api/v1/ai/generate` and `/ai/suggestions` require a bearer token (they are rate-limited
and `/suggestions` can call Claude), so sign up / log in first, then POST a `requirements`
object to get a full plan back.

The API treats any `ENV` other than `development` as production: it refuses to start
unless `JWT_SECRET` is a random value of at least 32 characters, and never echoes OTP codes.

### Everything via Docker
```bash
cp .env.example .env
docker compose up --build      # web :3100 · api :8000 · postgres :5432 · redis :6379
```
Postgres auto-applies `apps/api/db/schema.sql` on first boot.

## The planning engine

The differentiator. Given plot dimensions, facing and requirements it:

1. Applies size-aware **setbacks** to derive the buildable footprint.
2. Synthesises a **room program** per floor (areas, zones, Vastu ideal directions),
   distributing bedrooms/baths across floors.
3. Runs a **zonal squarified-slicing** solver — public → circulation → service →
   private bands oriented to the plot's facing — producing non-overlapping rooms
   that tile the footprint exactly.
4. Places **doors** (interior walls) and **windows** (exterior walls), computes
   **carpet/built-up efficiency**, and scores **Vastu** by comparing each room's
   actual compass octant to its ideal.
5. Emits actionable **suggestions** (ventilation, Vastu, cost, circulation).

It's implemented identically in TypeScript (`apps/web/src/lib/floorplan`) for instant
client-side generation and in Python (`apps/api/app/services/floorplan.py`) for the API.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design system, security,
scaling strategy and AWS deployment.

## Plot selection module

Open from any dashboard project → **Plot Details** (`/dashboard/projects/[id]/plot`):

- **Google Maps** with hybrid / satellite / terrain / map views, Places search, Street View.
- **Draw / edit / delete** the boundary: click to add corners, double-click to finish,
  drag vertices, right-click a vertex to remove, drag the whole polygon.
- **Live metrics** — area (ft² + m²), perimeter, length & width (PCA oriented bounding box),
  auto facing (overridable), reverse-geocoded address/city/state/country, lat/lng.
- **Validation** — blocks self-intersecting, empty or <3-point shapes (client *and* server).
- **Save/load** — POSTs to `/api/v1/plots` (server recomputes & validates as source of
  truth); falls back to `localStorage` without a backend, and hands plot dimensions to the
  planner wizard.
- **No Maps key?** A built-in offline SVG boundary editor keeps the whole flow working for
  dev and testing. Set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` to enable the real map.

Geometry lives in `apps/web/src/lib/geo/plot-geometry.ts` (TS, unit-tested with Vitest) and
`apps/api/app/services/geo.py` (Python, unit-tested with pytest).

## Roadmap (next milestones)
1. Wire auth end-to-end + Google ID-token verification + email/SMS OTP delivery.
2. Vastu-biased placement optimiser to lift compliance scores.
3. PDF & DXF (CAD) export via a worker; S3/CDN delivery.
4. Stripe/Razorpay subscriptions + admin analytics dashboard.
