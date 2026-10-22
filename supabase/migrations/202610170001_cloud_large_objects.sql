-- Upgrade existing private Storage services without replaying prior migrations.
-- Standard uploads remain immutable; the API negotiates one complete object.
update storage.buckets set public=false,file_size_limit=20971520 where id='lattice-shared-library';

create or replace function public.cloud_guard_upload_quota()
returns trigger language plpgsql security definer set search_path=public,storage as $$
declare used_bytes bigint; reserved_bytes bigint; quota_bytes bigint; requested_bytes bigint;
  object_bytes bigint; service_reserved bigint; service_quota bigint; is_supabase boolean;
begin
  is_supabase := coalesce(new.descriptor->>'storageBackend','r2')='supabase';
  if is_supabase then perform pg_advisory_xact_lock(hashtextextended('lattice-supabase-storage',1)); end if;
  perform pg_advisory_xact_lock(hashtextextended(new.library_id::text,1));
  requested_bytes := (new.descriptor->>'sizeBytes')::bigint;
  if requested_bytes is null or requested_bytes<0 or requested_bytes>104857600
    or new.descriptor->>'libraryId' is distinct from new.library_id::text
    or coalesce(new.descriptor->>'storageBackend','r2') not in ('r2','supabase')
    or not starts_with(coalesce(new.descriptor->>'key',''),'libraries/'||new.library_id::text||'/blobs/')
    or (is_supabase and (requested_bytes>20971520 or new.state<>'active' or new.expires_at<=now()
      or new.expires_at>now()+interval '24 hours'
      or (new.descriptor ? 'partSize' and (new.descriptor->>'partSize')::bigint<>greatest(requested_bytes,1)))) then
    raise exception 'Invalid upload descriptor' using errcode='22023';
  end if;
  select coalesce((settings->>'maxStorageBytes')::bigint,case when is_supabase then 1000000000 else 10737418240 end)
    into quota_bytes from public.libraries where id=new.library_id;
  select coalesce(sum(size_bytes),0) into used_bytes from public.blobs where library_id=new.library_id;
  select coalesce(sum(case when s.descriptor->>'storageBackend'='supabase' then
    coalesce((o.metadata->>'size')::bigint,20971520) else (s.descriptor->>'sizeBytes')::bigint end),0)
    into reserved_bytes from public.cloud_upload_sessions s
    left join storage.objects o on o.bucket_id='lattice-shared-library' and o.name=s.descriptor->>'key'
    where s.library_id=new.library_id and s.state='active'
      and (s.descriptor->>'storageBackend'='supabase' or s.expires_at>now())
      and not exists(select 1 from public.blobs b where b.storage_key=s.descriptor->>'key');
  -- Storage probes may have no metadata yet. Reserve the whole bucket maximum
  -- even for a declared 1-byte object, including sessions created pre-upgrade.
  if used_bytes+reserved_bytes+(case when is_supabase then 20971520 else requested_bytes end)>quota_bytes then
    raise exception 'Library storage quota exceeded' using errcode='P0001';
  end if;
  if is_supabase then
    select max_storage_bytes into service_quota from public.cloud_storage_limits where singleton;
    select coalesce(sum(coalesce((metadata->>'size')::bigint,1000000000)),0) into object_bytes from storage.objects;
    select coalesce(sum(20971520),0) into service_reserved from public.cloud_upload_sessions s
      where s.state='active' and s.descriptor->>'storageBackend'='supabase'
      and not exists(select 1 from storage.objects o where o.bucket_id='lattice-shared-library' and o.name=s.descriptor->>'key');
    if object_bytes+service_reserved+20971520>service_quota then
      raise exception 'Service storage quota exceeded' using errcode='P0001';
    end if;
  end if;
  return new;
end $$;

create or replace function public.cloud_library_usage(p_library_id uuid)
returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare used_bytes bigint; reserved_bytes bigint; quota_bytes bigint; service_used bigint; service_reserved bigint; service_quota bigint;
begin
  if not public.has_library_role(p_library_id,auth.uid(),'viewer') then raise exception 'Membership required' using errcode='42501'; end if;
  select coalesce((settings->>'maxStorageBytes')::bigint,1000000000) into quota_bytes from public.libraries where id=p_library_id;
  select coalesce(sum(size_bytes),0) into used_bytes from public.blobs where library_id=p_library_id;
  select coalesce(sum(case when s.descriptor->>'storageBackend'='supabase' then coalesce((o.metadata->>'size')::bigint,20971520)
    else (s.descriptor->>'sizeBytes')::bigint end),0) into reserved_bytes from public.cloud_upload_sessions s
    left join storage.objects o on o.bucket_id='lattice-shared-library' and o.name=s.descriptor->>'key'
    where s.library_id=p_library_id and s.state='active' and (s.descriptor->>'storageBackend'='supabase' or s.expires_at>now())
    and not exists(select 1 from public.blobs b where b.storage_key=s.descriptor->>'key');
  select coalesce(sum(coalesce((metadata->>'size')::bigint,1000000000)),0) into service_used from storage.objects;
  select coalesce(sum(20971520),0) into service_reserved from public.cloud_upload_sessions s where s.state='active'
    and s.descriptor->>'storageBackend'='supabase' and not exists(select 1 from storage.objects o
      where o.bucket_id='lattice-shared-library' and o.name=s.descriptor->>'key');
  select max_storage_bytes into service_quota from public.cloud_storage_limits where singleton;
  return jsonb_build_object('usedBytes',used_bytes,'reservedBytes',reserved_bytes,'maxStorageBytes',quota_bytes,
    'supabaseService',jsonb_build_object('usedBytes',service_used,'reservedBytes',service_reserved,'maxStorageBytes',service_quota));
end $$;

create function public.cloud_library_health(p_library_id uuid)
returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare bucket storage.buckets; expired_count bigint; pending_count bigint;
begin
  if not public.has_library_role(p_library_id,auth.uid(),'admin') then raise exception 'Admin membership required' using errcode='42501'; end if;
  select * into bucket from storage.buckets where id='lattice-shared-library';
  select count(*),count(*) filter(where expires_at<=now()) into pending_count,expired_count
    from public.cloud_upload_sessions where library_id=p_library_id and state='active' and descriptor->>'storageBackend'='supabase';
  return jsonb_build_object('schemaVersion','202610170001','bucketPrivate',bucket.id is not null and not bucket.public,
    'bucketMaxFileBytes',bucket.file_size_limit,'activeUploads',pending_count,'expiredUploads',expired_count,
    'usage',public.cloud_library_usage(p_library_id));
end $$;
revoke all on function public.cloud_library_health(uuid) from public,anon;
grant execute on function public.cloud_library_health(uuid) to authenticated;
