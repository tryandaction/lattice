create table public.cloud_ai_library_providers (
  library_id uuid not null references public.libraries(id) on delete cascade,
  provider_id text not null check(provider_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
  label text not null check(length(label) between 1 and 120),
  base_url text not null check(base_url ~ '^https://[^[:space:]?#]+$'),
  models text[] not null check(cardinality(models) between 1 and 64),
  api_key_ciphertext text not null check(api_key_ciphertext ~ '^v1\.[A-Za-z0-9+/]+=*\.[A-Za-z0-9+/]+=*$'),
  max_output_tokens integer not null check(max_output_tokens between 1 and 8192),
  request_budget_usd_micros bigint not null check(request_budget_usd_micros between 1 and 1000000000),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key(library_id, provider_id)
);
alter table public.cloud_ai_library_policies add column if not exists provider_source text not null default 'platform' check(provider_source in ('platform','library'));
alter table public.cloud_ai_library_providers enable row level security;
revoke all on public.cloud_ai_library_providers from public,anon,authenticated;
grant all on public.cloud_ai_library_providers to service_role;

create or replace function public.cloud_configure_team_ai_provider(
  p_library_id uuid,
  p_actor_id uuid,
  p_enabled boolean,
  p_max_requests_per_day integer,
  p_monthly_budget_usd_micros bigint,
  p_max_output_tokens integer,
  p_provider_id text,
  p_label text,
  p_base_url text,
  p_models text[],
  p_max_provider_tokens integer,
  p_request_budget_usd_micros bigint,
  p_api_key_ciphertext text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare allowed_ids text[]; previous_provider public.cloud_ai_library_providers;
begin
  if p_library_id is null or p_actor_id is null
    or p_provider_id is null or p_provider_id !~ '^[a-zA-Z0-9_-]{1,64}$'
    or p_label is null or length(p_label) not between 1 and 120
    or p_base_url is null or p_base_url !~ '^https://[^[:space:]?#]+$'
    or p_models is null or cardinality(p_models) not between 1 and 64
    or exists(select 1 from unnest(p_models) model where model is null or length(trim(model))=0 or length(model)>200)
    or (p_api_key_ciphertext is not null and p_api_key_ciphertext !~ '^v1\.[A-Za-z0-9+/]+=*\.[A-Za-z0-9+/]+=*$')
    or p_max_provider_tokens is null or p_max_provider_tokens not between 1 and 8192
    or p_request_budget_usd_micros is null or p_request_budget_usd_micros not between 1 and 1000000000
    or p_enabled is null or p_max_requests_per_day is null or p_max_requests_per_day not between 0 and 100000
    or p_monthly_budget_usd_micros is null or p_monthly_budget_usd_micros not between 0 and 1000000000000
    or p_max_output_tokens is null or p_max_output_tokens not between 1 and 8192
    or p_max_provider_tokens>p_max_output_tokens then
    raise exception 'Invalid team AI configuration' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_library_id::text,71));
  perform 1 from public.library_members m join public.libraries l on l.id=m.library_id
    where m.library_id=p_library_id and m.user_id=p_actor_id and m.status='active'
      and m.role in ('owner','admin') and l.archived_at is null for share of m,l;
  if not found then
    raise exception 'Library administrator required' using errcode='42501';
  end if;
  select * into previous_provider from public.cloud_ai_library_providers
    where library_id=p_library_id and provider_id=p_provider_id for update;
  if p_api_key_ciphertext is null and (previous_provider.provider_id is null or previous_provider.base_url<>p_base_url) then
    raise exception 'A new API key is required for a new endpoint' using errcode='22023';
  end if;

  insert into public.cloud_ai_library_providers(library_id,provider_id,label,base_url,models,api_key_ciphertext,max_output_tokens,request_budget_usd_micros,updated_by,updated_at)
    values(p_library_id,p_provider_id,p_label,p_base_url,p_models,coalesce(p_api_key_ciphertext,previous_provider.api_key_ciphertext),p_max_provider_tokens,p_request_budget_usd_micros,p_actor_id,now())
    on conflict(library_id,provider_id) do update set label=excluded.label,base_url=excluded.base_url,models=excluded.models,
      api_key_ciphertext=excluded.api_key_ciphertext,max_output_tokens=excluded.max_output_tokens,
      request_budget_usd_micros=excluded.request_budget_usd_micros,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

  select array_agg(provider_id order by provider_id) into allowed_ids
    from public.cloud_ai_library_providers where library_id=p_library_id;
  insert into public.cloud_ai_library_policies(library_id,enabled,allowed_provider_ids,max_requests_per_day,monthly_budget_usd_micros,max_output_tokens,provider_source,updated_at)
    values(p_library_id,p_enabled,coalesce(allowed_ids,array[p_provider_id]),p_max_requests_per_day,p_monthly_budget_usd_micros,p_max_output_tokens,'library',now())
    on conflict(library_id) do update set enabled=excluded.enabled,allowed_provider_ids=excluded.allowed_provider_ids,
      max_requests_per_day=excluded.max_requests_per_day,monthly_budget_usd_micros=excluded.monthly_budget_usd_micros,
      max_output_tokens=excluded.max_output_tokens,provider_source='library',updated_at=excluded.updated_at;
  return pg_catalog.jsonb_build_object('saved',true,'providerId',p_provider_id);
end $$;

create or replace function public.cloud_delete_team_ai_provider(p_library_id uuid,p_actor_id uuid,p_provider_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare remaining text[];
begin
  if p_library_id is null or p_actor_id is null or p_provider_id is null or p_provider_id !~ '^[a-zA-Z0-9_-]{1,64}$' then
    raise exception 'Invalid team AI provider' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_library_id::text,71));
  perform 1 from public.library_members m join public.libraries l on l.id=m.library_id
    where m.library_id=p_library_id and m.user_id=p_actor_id and m.status='active'
      and m.role in ('owner','admin') and l.archived_at is null for share of m,l;
  if not found then
    raise exception 'Library administrator required' using errcode='42501';
  end if;
  delete from public.cloud_ai_library_providers where library_id=p_library_id and provider_id=p_provider_id;
  select coalesce(array_agg(provider_id order by provider_id),array[]::text[]) into remaining
    from public.cloud_ai_library_providers where library_id=p_library_id;
  update public.cloud_ai_library_policies set allowed_provider_ids=remaining, provider_source='library',
    enabled=enabled and cardinality(remaining)>0,updated_at=now() where library_id=p_library_id;
  return pg_catalog.jsonb_build_object('deleted',true,'remainingProviders',cardinality(remaining));
end $$;

revoke all on function public.cloud_configure_team_ai_provider(uuid,uuid,boolean,integer,bigint,integer,text,text,text,text[],integer,bigint,text),
  public.cloud_delete_team_ai_provider(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.cloud_configure_team_ai_provider(uuid,uuid,boolean,integer,bigint,integer,text,text,text,text[],integer,bigint,text),
  public.cloud_delete_team_ai_provider(uuid,uuid,text) to service_role;

notify pgrst, 'reload schema';
