-- Pro plan: a one-time unlock per project, paid through Razorpay.
--
-- Rows are written only by the billing API (service role) after it has
-- verified Razorpay's payment signature; users can read their own unlocks.

create table public.project_unlocks (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null unique references public.projects (id) on delete cascade,
  user_id              uuid not null references auth.users (id) on delete cascade,
  razorpay_order_id    text not null unique,
  razorpay_payment_id  text not null unique,
  amount_paise         integer not null check (amount_paise > 0),
  currency             text not null default 'INR',
  created_at           timestamptz not null default now()
);

create index project_unlocks_user_idx on public.project_unlocks (user_id);

alter table public.project_unlocks enable row level security;

create policy "read own unlocks" on public.project_unlocks
  for select to authenticated using (user_id = (select auth.uid()));
-- No insert / update / delete policies: only the service role writes.

revoke all on public.project_unlocks from anon;
grant select on public.project_unlocks to authenticated;

-- Free accounts keep up to 3 projects; unlocked (Pro) projects don't count.
create or replace function public.enforce_free_project_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  free_projects integer;
begin
  select count(*) into free_projects
  from public.projects p
  where p.owner_id = new.owner_id
    and not exists (select 1 from public.project_unlocks u where u.project_id = p.id);
  if free_projects >= 3 then
    raise exception 'FREE_PROJECT_LIMIT'
      using hint = 'Free accounts keep 3 projects. Unlock one with Pro, or delete one.';
  end if;
  return new;
end;
$$;

create trigger projects_free_limit
  before insert on public.projects
  for each row execute function public.enforce_free_project_limit();
