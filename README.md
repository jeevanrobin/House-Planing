# AI Plot Planner

Draw your plot on the map, describe the home you want, and get a realistic,
Vastu-aware house plan that follows the shape of your land — drawn like an
architect's sheet, saved to your account.

## What's in the box

| Area | What it does |
| --- | --- |
| **Plot module** | Google Maps (hybrid / satellite / terrain), draw / edit the boundary, live area, perimeter, length / width, auto facing, reverse-geocoded address. Offline boundary editor when no Maps key is set. |
| **Planning engine** | Runs in the browser, no server or key needed. Sizes the house to the brief, follows irregular plot outlines, stacks stairs, places parking / pool / garden, scores Vastu against true north. |
| **Drawing** | Architectural sheet: real wall thicknesses, doors and swings, windows, furniture and fixtures, stair treads, dimension chains, title block. Floor-plan and site-plan views; blueprint dark mode; SVG / PNG export. |
| **Accounts & data** | Supabase Auth (email + password, magic link, Google) and Supabase Postgres with row-level security: projects, plots and saved plans. |
| **API** (`apps/api`) | FastAPI: optional Claude design critique of a plan (`/ai/suggestions`), authenticated with Supabase tokens, rate-limited. |

## Monorepo layout

```
.
├── apps/
│   ├── web/                    # Next.js 15 · React 19 · TypeScript · Tailwind
│   │   └── src/
│   │       ├── app/            # landing · /planner · /login · /dashboard
│   │       ├── components/     # planner, plot, UI primitives
│   │       └── lib/
│   │           ├── floorplan/  # ⭐ the planning engine + furniture
│   │           ├── data/       # Supabase data access (projects, plots, plans)
│   │           └── supabase/   # browser / server clients, session middleware
│   └── api/                    # FastAPI · Pydantic v2
├── supabase/migrations/        # database schema + row-level security
├── docker-compose.yml          # web · api · redis
└── .github/workflows/ci.yml    # typecheck · lint · tests · build · docker
```

## Set up

### 1. Supabase (accounts and data)

1. In your Supabase project, open **SQL Editor → New query**, paste
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) and **Run**.
2. **Authentication → URL Configuration**: set *Site URL* to your app's URL
   (`http://localhost:3100` for local work) and add `http://localhost:3100/auth/callback`
   (plus your production `/auth/callback`) to *Redirect URLs*.
3. Optional — **Authentication → Providers → Google**: enable it with a Google OAuth
   client (Google Cloud Console → Credentials → OAuth client ID, type *Web*, authorised
   redirect URI `https://<your-project>.supabase.co/auth/v1/callback`).
4. Copy the project URL and **publishable** key into `apps/web/.env.local` (see
   [`.env.example`](.env.example)). Never put the secret key in the web app.

### 2. Web app

```bash
cd apps/web
npm install
npm run dev          # http://localhost:3100
```

The planner works without Supabase or a Maps key; signing in and saving need Supabase.

### 3. API (optional — AI critique)

```bash
cd apps/api
python -m venv .venv && . .venv/Scripts/activate   # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload                       # http://localhost:8000/docs
```

Set `SUPABASE_URL` so the API can verify sign-ins. Any `ENV` other than `development`
is treated as production and refuses to start without it.

### Docker

```bash
cp .env.example .env           # fill in the Supabase values
docker compose up --build      # web :3100 · api :8000 · redis :6379
```

## The planning engine

In `apps/web/src/lib/floorplan`. Given the plot, facing and brief it:

1. **Sizes the house to the brief, not the plot** — realistic room areas and minimum
   dimensions, scaled by finish level. House widths are tried in steps; every floor is
   laid out and scored on room sizes, plot fit and site features.
2. **Follows the plot's shape** — the drawing is turned to square up with the road
   frontage (north arrow and Vastu use true north). Each band of rooms takes the width the
   land allows at its depth, so the outline steps with the boundary. *Maximise the plot*
   (default for map-drawn plots) grows the house towards ~60% coverage and adds courtyards;
   *Balanced* keeps a compact house with garden around it.
3. **Lays rooms out like a real home** — sit-out → living → kitchen / dining / stair →
   hallway → bedrooms with attached bath and dressing, along one connected circulation
   spine. Stairs stack on every floor.
4. **Places the site** — setbacks, cars in the front yard or a covered porch, pool and
   garden in the open land.
5. **Doors and windows from access rules** — bedrooms off the hallway, ensuites off their
   bedroom, never a toilet onto a kitchen or pooja room — then a connectivity pass makes
   sure every room is reachable.

`engine.test.ts` checks hard invariants over a seeded sweep of random briefs (rooms tile
each floor's outline with no overlaps, every room is reachable, stairs stack, everything
stays on the plot).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for more.

## Roadmap

1. 3D view of the generated plan.
2. Premium redesign of every page; Free / Pro plans.
3. PDF and DXF (CAD) export; photoreal renders.
