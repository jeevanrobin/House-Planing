-- AI Plot Planner — initial schema (Supabase Postgres).
--
-- Every table is owned by a Supabase Auth user and protected by row-level
-- security: a signed-in user can only see and change their own rows, and the
-- browser talks to these tables directly with the publishable key.
--
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user, created automatically on sign-up)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  avatar_url  text,
  plan_tier   text not null default 'free' check (plan_tier in ('free', 'pro')),
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index projects_owner_idx on public.projects (owner_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Plots (the land, drawn on the map)
-- ---------------------------------------------------------------------------
create table public.plots (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  boundary     jsonb not null,               -- GeoJSON Polygon (lng/lat)
  area_sqm     numeric(12, 2) not null check (area_sqm > 0),
  perimeter_m  numeric(10, 2),
  length_m     numeric(10, 2),
  width_m      numeric(10, 2),
  facing       text not null check (facing in ('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW')),
  latitude     double precision,
  longitude    double precision,
  address      text,
  city         text,
  state        text,
  country      text,
  created_at   timestamptz not null default now(),
  constraint plots_boundary_size check (pg_column_size(boundary) < 200000)
);
create index plots_project_idx on public.plots (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Plans (a generated house plan saved to a project)
-- ---------------------------------------------------------------------------
create table public.plans (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 120),
  requirements  jsonb not null,
  plan          jsonb not null,
  vastu_score   smallint check (vastu_score between 0 and 100),
  built_up_sqm  numeric(10, 2),
  created_at    timestamptz not null default now(),
  constraint plans_plan_size check (pg_column_size(plan) < 2000000)
);
create index plans_project_idx on public.plans (project_id, created_at desc);

-- Keep projects.updated_at fresh when the project or its plans/plots change.
create or replace function public.touch_project()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'projects' then
    new.updated_at := now();
    return new;
  end if;
  update public.projects set updated_at = now() where id = new.project_id;
  return new;
end;
$$;

create trigger projects_touch before update on public.projects
  for each row execute function public.touch_project();
create trigger plots_touch_project after insert on public.plots
  for each row execute function public.touch_project();
create trigger plans_touch_project after insert on public.plans
  for each row execute function public.touch_project();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.plots    enable row level security;
alter table public.plans    enable row level security;

-- Profiles: read and edit your own (rows are created by the trigger).
create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Projects: full control of your own.
create policy "projects: read own" on public.projects
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "projects: create own" on public.projects
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "projects: update own" on public.projects
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "projects: delete own" on public.projects
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Plots and plans: your own, and only inside a project you own.
create policy "plots: read own" on public.plots
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "plots: create in own project" on public.plots
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy "plots: delete own" on public.plots
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "plans: read own" on public.plans
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "plans: create in own project" on public.plans
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy "plans: rename own" on public.plans
  for update to authenticated using (owner_id = (select auth.uid())) with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy "plans: delete own" on public.plans
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Nothing is readable without signing in.
revoke all on public.profiles, public.projects, public.plots, public.plans from anon;
