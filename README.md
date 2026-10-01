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
│       │   ├── services/llm.py         # optional Claude critique of a plan
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
| **AI planning engine** | ✅ | Realistic house sizing, band layout with a circulation spine, stacked stairs, site planning (parking / pool / garden), access-based doors — offline, **no API key** |
| **2D plan generator** | ✅ | Architectural drawing: real wall thicknesses, door swings, windows, stair treads, tiled wet areas, railings, ft-in dimensions, floor-plan and site-plan views |
| **Interactive editor** | ✅ | Drag, resize, retype rooms, undo/redo |
| Exports | ✅ PNG/SVG · ⏳ PDF/DXF | Client-side raster/vector now; CAD later |
| Dashboard | ✅ (mock data) | Projects, stats, subscription shell |
| Backend API | 🟡 scaffold | Auth + `/ai/suggestions` (Claude critique of a browser-generated plan); projects need a DB |
| Auth (email/OTP/Google/JWT) | ✅ API · ⏳ UI | Password, email OTP (SMTP), Google ID-token sign-in, refresh-token rotation with reuse detection, logout. No login screens yet |
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

`/api/v1/ai/suggestions` requires a bearer token (it is rate-limited and can call Claude):
sign up / log in first, then POST `{ requirements, plan }` with a plan generated in the web app.

The API treats any `ENV` other than `development` as production: it refuses to start
unless `JWT_SECRET` is a random value of at least 32 characters, and never echoes OTP codes.

### Everything via Docker
```bash
cp .env.example .env
docker compose up --build      # web :3100 · api :8000 · postgres :5432 · redis :6379
```
Postgres auto-applies `apps/api/db/schema.sql` on first boot.

## The planning engine

The differentiator, in `apps/web/src/lib/floorplan` (TypeScript, runs instantly in the
browser — no server or API key). Given the plot, facing and brief it:

1. **Sizes the house to the brief, not the plot.** Each room has a realistic target area
   and minimum width/depth (scaled by luxury level and budget). The engine tries house
   widths in 25 cm steps, lays every floor out, and keeps the width whose rooms best hit
   their targets while fitting the buildable area and the yards.
2. **Lays rooms out in front-to-back bands** like a real Indian home: sit-out → living
   (+ guest bedroom) → kitchen / dining / stair → hallway → bedrooms with attached bath and
   dressing. Living, dining, stair and hallways form one connected circulation spine.
3. **Stacks floors on one structural core** — the staircase sits in exactly the same
   place on every floor; spare depth upstairs becomes an open terrace.
4. **Places the house on the site** with setbacks; cars, pool and garden go in the open
   yards (or a covered car porch on small plots). Tight plots get compact rooms, then
   drop the sit-out, before anything is squashed.
5. **Doors and windows from access rules** (bedrooms off the hallway, ensuites off their
   bedroom, kitchen off dining, main door facing the road), then a connectivity pass
   guarantees every room is reachable. Real wall thicknesses (230 / 115 mm).
6. **Scores Vastu** per room octant, tries mirrored/reordered variants, keeps the best.

`engine.test.ts` checks hard invariants over a seeded sweep of random briefs: rooms tile
the house exactly with no overlaps, every room is reachable, stairs stack, and site
features stay on the plot and clear of the house.

The API (`/ai/suggestions`) accepts the plan the browser generated and adds an optional
Claude design critique.

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
1. Login / sign-up screens in the web app (the auth API is done) + SMS OTP.
2. Vastu-biased placement optimiser to lift compliance scores.
3. PDF & DXF (CAD) export via a worker; S3/CDN delivery.
4. Stripe/Razorpay subscriptions + admin analytics dashboard.
