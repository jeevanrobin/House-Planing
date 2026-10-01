# Architecture

## 1. System overview

```
                       ┌────────────────────────┐
        Browser  ─────▶ │  Next.js 15 (SSR/edge) │  ── static/CDN (CloudFront)
                        └───────────┬────────────┘
                                    │ HTTPS / JWT (Bearer)
                        ┌───────────▼────────────┐
                        │   FastAPI (ASGI)        │
                        │   • auth  • projects    │
                        │   • ai/suggestions      │
                        └─────┬──────────┬────────┘
                              │          │
                   ┌──────────▼───┐  ┌───▼─────────┐
                   │ PostgreSQL 16│  │   Redis     │  (cache, rate-limit,
                   └──────────────┘  └─────────────┘   OTP, job queue)
                              │
                   ┌──────────▼───────────┐
                   │ Worker (RQ/Celery)   │  PDF/DXF export, heavy AI jobs
                   └──────────┬───────────┘
                              ▼
                        S3 + CloudFront (exported files, assets)
```

The planning engine is **CPU-only and deterministic**, so plan generation runs
synchronously inside the API (and even client-side in the browser). Only export
rendering (PDF/DXF) and any future LLM-assisted refinement are offloaded to workers.

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
| AuthN | JWT access (30 min) + rotating refresh tokens hashed at rest |
| Passwords | bcrypt via passlib; OAuth accounts have no password |
| OTP | 6-digit, hashed, TTL; locked after 5 wrong guesses; constant-time compare; never returned in prod |
| Rate limiting | `slowapi` (Redis-backed in prod) per-IP defaults |
| Headers | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, CSP at the edge |
| CSRF | Token-in-header pattern for cookie flows; bearer tokens are CSRF-immune |
| XSS | React auto-escaping; no `dangerouslySetInnerHTML`; strict CSP |
| Transport | TLS everywhere; HSTS at the load balancer |
| Secrets | Env-injected; AWS Secrets Manager / SSM in prod; sensitive columns encryptable |

## 4. Performance

- **SSR + static** — landing & marketing prerendered; dashboard/planner are client islands.
- **Code-splitting** — heavy planner/editor isolated to their routes (see build output).
- **Caching** — React Query on the client; Redis for API responses & metering; CDN for assets.
- **Images** — Next/Image with AVIF/WebP.
- **Engine** — O(rooms) slicing; sub-millisecond generation, no network round-trip.

## 5. Scaling to 100k+ users

- **Stateless API** behind an ALB → horizontal autoscaling (ECS Fargate / EKS).
- **Postgres** — managed RDS/Aurora with a read replica; partition `usage_events`,
  `ai_generations` by month; covering indexes already defined for hot paths.
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
                                   ├─ RDS Aurora PostgreSQL (Multi-AZ + replica)
                                   ├─ ElastiCache Redis
                                   └─ ECS Fargate: worker pool
Secrets Manager · CloudWatch (logs/metrics/alarms) · WAF on CloudFront/ALB
```

CI (`.github/workflows/ci.yml`) typechecks, lints, builds the web app, runs the
engine smoke test, imports the API, and builds both Docker images. CD (to add):
push images to ECR and `aws ecs update-service` per environment, gated on CI green.

## 7. Data model

See `apps/api/db/schema.sql` — users, otp_codes, refresh_tokens, subscriptions,
payments, projects, plots, requirements, floor_plans (versioned), ai_generations,
exports, usage_events. UUID PKs, `JSONB` for plan/boundary payloads, partial unique
indexes for "one active subscription" and "one current plan per project".
