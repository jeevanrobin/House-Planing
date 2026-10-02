# Architecture

## 1. System overview

```
                 ┌─────────────────────────────┐
  Browser ─────▶ │ Next.js 15 (SSR + client)    │ ── static/CDN
                 │ • planning engine (TS)       │
                 │ • drawing / editor / export  │
                 └──┬─────────────┬────────────┘
     publishable key│             │ Supabase access token (Bearer)
       + RLS        │             │
          ┌─────────▼──────┐  ┌───▼──────────────────┐
          │ Supabase        │  │ FastAPI              │
          │ • Auth (email,  │  │ • /ai/suggestions    │──▶ Claude (Vertex AI)
          │   magic link,   │  │   (verifies tokens   │
          │   Google)       │  │    via project JWKS) │
          │ • Postgres +RLS │  └───┬──────────────────┘
          │   projects,     │      │
          │   plots, plans  │  ┌───▼────┐
          └─────────────────┘  │ Redis  │ rate limits
                               └────────┘
```

The planning engine is **CPU-only and deterministic** and runs in the browser, so a
plan appears instantly with no server round-trip. The browser reads and writes its own
data directly in Supabase; row-level security (`supabase/migrations`) guarantees a user
can only reach their own rows. The API exists for work that needs server credentials:
today the optional Claude critique; later exports and renders.

## 2. Design system

- **Tokens** — semantic HSL CSS variables in `globals.css`, light + dark, driven by
  `next-themes` (`class` strategy). Tailwind maps them to `bg-background`, `text-primary`, …
- **Palette** — indigo→violet primary, teal accent; premium, Apple-adjacent restraint.
- **Glassmorphism** — `.glass` / `.glass-strong` utilities (blur + saturate + translucent
  borders) used on cards, nav and CTAs.
- **Typography** — `Sora` (display) + `Inter` (body), with OpenType features enabled.
- **Motion** — Framer Motion for scroll-reveal (`fade-up`) and step transitions; respects
  reduced-motion via Framer defaults.
- **Responsiveness** — mobile-first; container caps at 1280px; grids collapse 3→2→1.

## 3. Security

| Concern | Approach |
| --- | --- |
| AuthN | Supabase Auth (email + password, magic link, Google). Sessions in HTTP-only cookies, refreshed by Next.js middleware. |
| AuthZ | Row-level security on every table: owner-only reads/writes; plots and plans can only be created inside a project you own. |
| API auth | Supabase access tokens verified against the project's public JWKS (ES256/RS256 only; audience, issuer, expiry checked). No shared secret. |
| Keys | Only the publishable key reaches the browser; the secret key is never used by the web app. |
| Redirects | Post-login `next` paths are restricted to same-site paths (no open redirects). |
| Rate limiting | `slowapi` (Redis-backed in prod) per-IP defaults, stricter on AI routes. |
| Headers | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, CSP at the edge |
| XSS | React auto-escaping; no `dangerouslySetInnerHTML` |

## 4. Performance

- **SSR + static** — landing & marketing prerendered; dashboard/planner are client islands.
- **Code-splitting** — heavy planner/editor isolated to their routes (see build output).
- **Caching** — React Query on the client; Redis for API responses & metering; CDN for assets.
- **Images** — Next/Image with AVIF/WebP.
- **Engine** — O(rooms) slicing; sub-millisecond generation, no network round-trip.

## 5. Scaling to 100k+ users

- **Stateless API** behind an ALB → horizontal autoscaling (ECS Fargate / EKS).
- **Supabase Postgres** — managed, with connection pooling; indexes on `(owner_id, updated_at)` and
  `(project_id, created_at)` cover the dashboard queries.
- **Redis** — ElastiCache (cluster mode) for cache, rate limiting and the job queue.
- **Workers** — separate autoscaled pool for exports; queue depth drives scale.
- **Object storage** — S3 for exports/assets, served via CloudFront.
- **Idempotent generation** — deterministic engine means results are cacheable by a
  hash of the requirements payload.

## 6. AWS deployment (reference)

```
Route53 → CloudFront ──▶ S3 (web static) 
                    └──▶ ALB ──▶ ECS Fargate: web (Next server) 
                              └▶ ECS Fargate: api (uvicorn, N tasks)
                                   ├─ Supabase (Auth + Postgres, managed)
                                   ├─ ElastiCache Redis
                                   └─ ECS Fargate: worker pool
Secrets Manager · CloudWatch (logs/metrics/alarms) · WAF on CloudFront/ALB
```

CI (`.github/workflows/ci.yml`) typechecks, lints, tests and builds the web app,
runs the API tests, and builds both Docker images. CD (to add):
push images to ECR and `aws ecs update-service` per environment, gated on CI green.

## 7. Data model

See `supabase/migrations/0001_init.sql`: `profiles` (one per auth user, created by
trigger), `projects`, `plots` (GeoJSON boundary + metrics) and `plans` (the brief and
the generated plan as JSONB, with Vastu score and built-up area for listings). UUID
keys, cascading deletes from the auth user down, size limits on JSON payloads.
