-- Provider credentials and upstream URLs exist only in the Worker's secret config.
-- Operators explicitly provision each library policy; members cannot raise budgets.
create table public.cloud_ai_library_policies (
  library_id uuid primary key references public.libraries(id) on delete cascade,
  enabled boolean not null default false,
  allowed_provider_ids text[] not null default '{}',
  max_requests_per_day integer not null default 100 check(max_requests_per_day between 0 and 100000),
  monthly_budget_usd_micros bigint not null default 1000000 check(monthly_budget_usd_micros between 0 and 1000000000000),
  max_output_tokens integer not null default 1024 check(max_output_tokens between 1 and 8192),
  updated_at timestamptz not null default now(),
  check(cardinality(allowed_provider_ids)<=32)
);
alter table public.cloud_ai_library_policies enable row level security;
create policy cloud_ai_library_policies_read on public.cloud_ai_library_policies for select to authenticated
  using(public.is_library_member(library_id,auth.uid()));
revoke all on public.cloud_ai_library_policies from public,anon,authenticated;
grant select on public.cloud_ai_library_policies to authenticated;
grant all on public.cloud_ai_library_policies to service_role;

-- A conservative fixed request allocation, not an assertion of provider invoice cost.
-- Every admitted attempt stays charged, including upstream failures/timeouts.
create table public.cloud_ai_requests (
  id uuid primary key,
  library_id uuid not null references public.libraries(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  provider_id text not null check(provider_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
  reserved_usd_micros bigint not null check(reserved_usd_micros between 1 and 1000000000),
  max_output_tokens integer not null check(max_output_tokens between 1 and 8192),
  created_at timestamptz not null default now()
);
create index cloud_ai_requests_library_period on public.cloud_ai_requests(library_id,created_at);
alter table public.cloud_ai_requests enable row level security;
revoke all on public.cloud_ai_requests from public,anon,authenticated;
grant select,insert on public.cloud_ai_requests to service_role;

create or replace function public.cloud_reserve_ai_request(
  p_library_id uuid,p_user_id uuid,p_provider_id text,p_request_id uuid,
  p_reserved_usd_micros bigint,p_max_output_tokens integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare policy public.cloud_ai_library_policies; daily_requests bigint; monthly_reserved bigint;
  day_start timestamptz; month_start timestamptz;
begin
  if p_library_id is null or p_user_id is null or p_request_id is null
    or p_provider_id is null or p_provider_id !~ '^[a-zA-Z0-9_-]{1,64}$'
    or p_reserved_usd_micros is null or p_reserved_usd_micros not between 1 and 1000000000
    or p_max_output_tokens is null or p_max_output_tokens not between 1 and 8192 then
    raise exception 'Invalid AI reservation' using errcode='22023';
  end if;
  -- Serialize all providers and callers in the same library through commit.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_library_id::text,71));
  select * into policy from public.cloud_ai_library_policies where library_id=p_library_id for update;
  if policy.library_id is null or not policy.enabled
    or not (p_provider_id=any(policy.allowed_provider_ids))
    or not exists(select 1 from public.library_members m join public.libraries l on l.id=m.library_id
      where m.library_id=p_library_id and m.user_id=p_user_id and m.status='active' and l.archived_at is null) then
    raise exception 'AI permission denied' using errcode='42501';
  end if;
  if p_max_output_tokens>policy.max_output_tokens then
    raise exception 'AI output limit exceeded' using errcode='22023';
  end if;
  day_start := pg_catalog.date_trunc('day',pg_catalog.now() at time zone 'UTC') at time zone 'UTC';
  month_start := pg_catalog.date_trunc('month',pg_catalog.now() at time zone 'UTC') at time zone 'UTC';
  select count(*) into daily_requests from public.cloud_ai_requests where library_id=p_library_id and created_at>=day_start;
  select coalesce(sum(reserved_usd_micros),0) into monthly_reserved from public.cloud_ai_requests where library_id=p_library_id and created_at>=month_start;
  if daily_requests>=policy.max_requests_per_day or monthly_reserved+p_reserved_usd_micros>policy.monthly_budget_usd_micros then
    raise exception 'Library AI quota exceeded' using errcode='P0001';
  end if;
  insert into public.cloud_ai_requests(id,library_id,user_id,provider_id,reserved_usd_micros,max_output_tokens)
    values(p_request_id,p_library_id,p_user_id,p_provider_id,p_reserved_usd_micros,p_max_output_tokens);
  return pg_catalog.jsonb_build_object('reservationId',p_request_id);
end $$;
-- This RPC consumes server-provided identity only after Auth validation in Worker.
-- Neither anon nor authenticated callers can invoke it directly with a forged user.
revoke all on function public.cloud_reserve_ai_request(uuid,uuid,text,uuid,bigint,integer) from public,anon,authenticated;
grant execute on function public.cloud_reserve_ai_request(uuid,uuid,text,uuid,bigint,integer) to service_role;

notify pgrst, 'reload schema';
