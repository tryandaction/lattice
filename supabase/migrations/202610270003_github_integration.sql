-- GitHub App user tokens belong to the server. A verified /auth/v1/user result
-- is required by the Worker before it can call any of these service-only RPCs.
create table public.cloud_github_identities (
  user_id uuid primary key references auth.users(id) on delete cascade,
  github_user_id bigint not null unique check(github_user_id > 0),
  login text not null, updated_at timestamptz not null default now()
);
create table public.cloud_github_tokens (
  user_id uuid primary key references public.cloud_github_identities(user_id) on delete cascade,
  access_cipher text not null, refresh_cipher text not null,
  expires_at timestamptz not null, refresh_expires_at timestamptz not null,
  refresh_locked_until timestamptz, updated_at timestamptz not null default now(),
  check(access_cipher like 'v1.%' and refresh_cipher like 'v1.%')
);
create table public.cloud_github_oauth_states (
  state_hash text primary key, user_id uuid not null references auth.users(id) on delete cascade,
  verifier_cipher text not null, redirect_uri text not null, expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index cloud_github_oauth_expiry on public.cloud_github_oauth_states(expires_at);
create table public.cloud_github_connections (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null unique references public.libraries(id) on delete cascade,
  repository_id bigint not null check(repository_id > 0),
  installation_id bigint not null check(installation_id > 0),
  owner text not null, name text not null, branch text not null, private boolean not null,
  connected_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), last_synced_at timestamptz
);
create index cloud_github_connections_repo on public.cloud_github_connections(repository_id);
create table public.cloud_github_member_grants (
  connection_id uuid not null references public.cloud_github_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(connection_id,user_id)
);

alter table public.cloud_github_identities enable row level security;
alter table public.cloud_github_tokens enable row level security;
alter table public.cloud_github_oauth_states enable row level security;
alter table public.cloud_github_connections enable row level security;
alter table public.cloud_github_member_grants enable row level security;
revoke all on public.cloud_github_identities,public.cloud_github_tokens,public.cloud_github_oauth_states,public.cloud_github_connections,public.cloud_github_member_grants from public,anon,authenticated;
grant all on public.cloud_github_identities,public.cloud_github_tokens,public.cloud_github_oauth_states,public.cloud_github_connections,public.cloud_github_member_grants to service_role;
grant select on public.cloud_github_identities,public.cloud_github_connections to authenticated;
create policy cloud_github_own_identity on public.cloud_github_identities for select to authenticated using(user_id=auth.uid());
create policy cloud_github_member_connection on public.cloud_github_connections for select to authenticated using(public.is_library_member(library_id,auth.uid()));

create or replace function public.cloud_github_bind_identity(p_user_id uuid,p_github_user_id bigint,p_login text,p_tokens jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,51));
  -- The immutable numeric GitHub ID is the identity; a login can be renamed.
  if exists(select 1 from public.cloud_github_identities where user_id=p_user_id and github_user_id<>p_github_user_id) then
    raise exception 'A different GitHub identity is already connected' using errcode='23505';
  end if;
  insert into public.cloud_github_identities(user_id,github_user_id,login) values(p_user_id,p_github_user_id,p_login)
    on conflict(user_id) do update set login=excluded.login,updated_at=now();
  insert into public.cloud_github_tokens(user_id,access_cipher,refresh_cipher,expires_at,refresh_expires_at)
    values(p_user_id,p_tokens->>'access_cipher',p_tokens->>'refresh_cipher',(p_tokens->>'expires_at')::timestamptz,(p_tokens->>'refresh_expires_at')::timestamptz)
    on conflict(user_id) do update set access_cipher=excluded.access_cipher,refresh_cipher=excluded.refresh_cipher,expires_at=excluded.expires_at,refresh_expires_at=excluded.refresh_expires_at,refresh_locked_until=null,updated_at=now();
end $$;

create or replace function public.cloud_github_claim_refresh(p_user_id uuid)
returns setof public.cloud_github_tokens language sql security definer set search_path=public as $$
  update public.cloud_github_tokens set refresh_locked_until=now()+interval '60 seconds'
  where user_id=p_user_id and expires_at<=now()+interval '60 seconds' and refresh_expires_at>now()
    and (refresh_locked_until is null or refresh_locked_until<now()) returning *;
$$;

create or replace function public.cloud_github_connect(p_library_id uuid,p_actor_id uuid,p_repository jsonb)
returns public.cloud_github_connections language plpgsql security definer set search_path=public as $$
declare result public.cloud_github_connections;
begin
  if not public.has_library_role(p_library_id,p_actor_id,'admin') then raise exception 'Library admin required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_library_id::text,52));
  select * into result from public.cloud_github_connections where library_id=p_library_id for update;
  if result.id is not null then
    if result.repository_id<>(p_repository->>'repository_id')::bigint or result.installation_id<>(p_repository->>'installation_id')::bigint then
      raise exception 'Disconnect the existing repository first' using errcode='23505';
    end if;
    update public.cloud_github_connections set owner=p_repository->>'owner',name=p_repository->>'name',branch=p_repository->>'branch',private=(p_repository->>'private')::boolean where id=result.id returning * into result;
  else
    insert into public.cloud_github_connections(library_id,repository_id,installation_id,owner,name,branch,private,connected_by)
    values(p_library_id,(p_repository->>'repository_id')::bigint,(p_repository->>'installation_id')::bigint,p_repository->>'owner',p_repository->>'name',p_repository->>'branch',(p_repository->>'private')::boolean,p_actor_id) returning * into result;
  end if;
  return result;
end $$;

-- Any explicit/manual membership change takes ownership away from GitHub sync.
-- The client cannot add provenance because the grants table has no client grants.
create or replace function public.cloud_github_preserve_manual_membership()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then
    -- Profile/presence updates must not turn an automatic editor into a
    -- permanent manual member. Only a real membership/permission change does.
    if tg_op='UPDATE' and new.role is not distinct from old.role and new.status is not distinct from old.status
      and new.library_id=old.library_id and new.user_id=old.user_id then return new; end if;
    if tg_op='DELETE' then
      delete from public.cloud_github_member_grants g using public.cloud_github_connections c where g.connection_id=c.id and c.library_id=old.library_id and g.user_id=old.user_id;
      return old;
    end if;
    delete from public.cloud_github_member_grants g using public.cloud_github_connections c where g.connection_id=c.id and c.library_id=new.library_id and g.user_id=new.user_id;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger cloud_github_manual_member before insert or update or delete on public.library_members for each row execute function public.cloud_github_preserve_manual_membership();

create or replace function public.cloud_github_sync_members(p_connection_id uuid,p_actor_id uuid,p_github_user_ids jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare connection public.cloud_github_connections; member record; inserted integer; granted integer:=0; revoked integer:=0; matched integer:=0;
begin
  select * into connection from public.cloud_github_connections where id=p_connection_id for update;
  -- Null actor is reserved for the signature-verified background webhook path.
  -- This RPC is executable only by service_role, never by a browser identity.
  if connection.id is null or (p_actor_id is not null and not public.has_library_role(connection.library_id,p_actor_id,'admin')) then raise exception 'Library admin required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(connection.library_id::text,53));
  if jsonb_typeof(p_github_user_ids)<>'array' then raise exception 'Invalid collaborator IDs' using errcode='22023'; end if;
  for member in select i.user_id from public.cloud_github_identities i where i.github_user_id in(select value::bigint from jsonb_array_elements_text(p_github_user_ids)) loop
    matched:=matched+1;
    insert into public.library_members(library_id,user_id,role,status) values(connection.library_id,member.user_id,'editor','active') on conflict(library_id,user_id) do nothing;
    get diagnostics inserted=row_count;
    if inserted>0 then
      insert into public.cloud_github_member_grants(connection_id,user_id) values(connection.id,member.user_id) on conflict do nothing;
      granted:=granted+1;
    end if;
  end loop;
  for member in select g.user_id from public.cloud_github_member_grants g where g.connection_id=connection.id and not exists(select 1 from public.cloud_github_identities i where i.user_id=g.user_id and i.github_user_id in(select value::bigint from jsonb_array_elements_text(p_github_user_ids))) loop
    delete from public.library_members where library_id=connection.library_id and user_id=member.user_id and role='editor' and status='active';
    get diagnostics inserted=row_count; revoked:=revoked+inserted;
    delete from public.cloud_github_member_grants where connection_id=connection.id and user_id=member.user_id;
  end loop;
  update public.cloud_github_connections set last_synced_at=now() where id=connection.id;
  return jsonb_build_object('granted',granted,'revoked',revoked,'matched',matched,'unbound',jsonb_array_length(p_github_user_ids)-matched);
end $$;

-- Called after the Worker verifies this very user's current installation+push
-- permissions. It may only grant the newly bound identity, never another user.
create or replace function public.cloud_github_join_connections(p_user_id uuid,p_repository_ids jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare connection public.cloud_github_connections; inserted integer; joined integer:=0;
begin
  if not exists(select 1 from public.cloud_github_identities where user_id=p_user_id) then raise exception 'Verified GitHub identity required' using errcode='42501'; end if;
  for connection in select * from public.cloud_github_connections where repository_id in(select value::bigint from jsonb_array_elements_text(p_repository_ids)) order by library_id for update loop
    perform pg_advisory_xact_lock(hashtextextended(connection.library_id::text,53));
    insert into public.library_members(library_id,user_id,role,status) values(connection.library_id,p_user_id,'editor','active') on conflict(library_id,user_id) do nothing;
    get diagnostics inserted=row_count;
    if inserted>0 then insert into public.cloud_github_member_grants(connection_id,user_id) values(connection.id,p_user_id) on conflict do nothing; joined:=joined+1; end if;
  end loop;
  return joined;
end $$;

create or replace function public.cloud_github_cleanup_connection()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  delete from public.library_members m where m.library_id=old.library_id and m.role='editor' and m.status='active' and exists(select 1 from public.cloud_github_member_grants g where g.connection_id=old.id and g.user_id=m.user_id);
  return old;
end $$;
create trigger cloud_github_connection_cleanup before delete on public.cloud_github_connections for each row execute function public.cloud_github_cleanup_connection();
create or replace function public.cloud_github_disconnect(p_connection_id uuid,p_actor_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare target_library uuid;
begin
  select library_id into target_library from public.cloud_github_connections where id=p_connection_id for update;
  if target_library is null or not public.has_library_role(target_library,p_actor_id,'admin') then raise exception 'Library admin required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_library::text,53));
  delete from public.cloud_github_connections where id=p_connection_id;
end $$;

-- Postgres grants EXECUTE to PUBLIC by default: explicitly close every RPC,
-- including trigger helpers, so none can be invoked as a client privilege bypass.
revoke all on function public.cloud_github_bind_identity(uuid,bigint,text,jsonb),public.cloud_github_claim_refresh(uuid),public.cloud_github_connect(uuid,uuid,jsonb),public.cloud_github_preserve_manual_membership(),public.cloud_github_sync_members(uuid,uuid,jsonb),public.cloud_github_join_connections(uuid,jsonb),public.cloud_github_cleanup_connection(),public.cloud_github_disconnect(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cloud_github_bind_identity(uuid,bigint,text,jsonb),public.cloud_github_claim_refresh(uuid),public.cloud_github_connect(uuid,uuid,jsonb),public.cloud_github_sync_members(uuid,uuid,jsonb),public.cloud_github_join_connections(uuid,jsonb),public.cloud_github_disconnect(uuid,uuid) to service_role;

create table public.cloud_github_webhook_deliveries (
  delivery_id text primary key, event text not null, payload jsonb not null,
  status text not null default 'pending' check(status in ('pending','processing','complete','failed')),
  attempts integer not null default 0, available_at timestamptz not null default now(),
  leased_until timestamptz, last_error text, created_at timestamptz not null default now(), completed_at timestamptz
);
alter table public.cloud_github_webhook_deliveries enable row level security;
revoke all on public.cloud_github_webhook_deliveries from public,anon,authenticated;
grant all on public.cloud_github_webhook_deliveries to service_role;
create index cloud_github_webhook_retry on public.cloud_github_webhook_deliveries(status,available_at);
create or replace function public.cloud_github_claim_webhooks(p_delivery_id text default null)
returns setof public.cloud_github_webhook_deliveries language sql security definer set search_path=public as $$
  update public.cloud_github_webhook_deliveries d set status='processing',attempts=attempts+1,leased_until=now()+interval '5 minutes'
  where delivery_id in (
    select delivery_id from public.cloud_github_webhook_deliveries
    where (p_delivery_id is null or delivery_id=p_delivery_id)
      and ((status in ('pending','failed') and available_at<=now()) or (status='processing' and leased_until<now()))
    order by created_at for update skip locked limit 20
  ) returning d.*;
$$;
revoke all on function public.cloud_github_claim_webhooks(text) from public,anon,authenticated;
grant execute on function public.cloud_github_claim_webhooks(text) to service_role;

-- Linked-source baselines are patches, never a replacement of a stale client
-- metadata snapshot. Row locking serializes this with immutable version commits.
create or replace function public.cloud_update_item_metadata(p_item_id uuid,p_patch jsonb,p_expected_version_id uuid)
returns public.items language plpgsql security invoker set search_path=public as $$
declare current_item public.items; result public.items;
begin
  if p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'Metadata patch must be an object' using errcode='22023'; end if;
  if p_patch ? 'parentItemId' or p_patch ? 'expectedParentVersion' then raise exception 'Metadata patch cannot move an item' using errcode='22023'; end if;
  select * into current_item from public.items where id=p_item_id for update;
  if current_item.id is null or current_item.status<>'active' or not public.has_library_role(current_item.library_id,auth.uid(),'editor') then
    raise exception 'Item editor permission required' using errcode='42501';
  end if;
  if current_item.current_version_id is distinct from p_expected_version_id then raise exception 'Item version changed' using errcode='40001'; end if;
  update public.items set metadata=metadata||p_patch,updated_at=now() where id=p_item_id returning * into result;
  return result;
end $$;
revoke all on function public.cloud_update_item_metadata(uuid,jsonb,uuid) from public,anon;
grant execute on function public.cloud_update_item_metadata(uuid,jsonb,uuid) to authenticated;
