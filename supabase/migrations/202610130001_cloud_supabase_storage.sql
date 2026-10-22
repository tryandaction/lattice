-- Optional Supabase Storage backend. Apply after the Auth5 cloud migrations.
-- No service-role key is needed by the Worker. Bucket is private and immutable.
insert into storage.buckets(id,name,public,file_size_limit)
values ('lattice-shared-library','lattice-shared-library',false,5242880)
on conflict(id) do update set public=false,file_size_limit=5242880;

alter table public.blobs add column storage_backend text not null default 'r2'
  check(storage_backend in ('r2','supabase'));

-- Supabase Free currently includes 1 GB storage. Leave a small safety margin;
-- operators may lower this value, but the application cannot raise it above 1 GB.
create table public.cloud_storage_limits (
  singleton boolean primary key default true check(singleton),
  max_storage_bytes bigint not null default 950000000 check(max_storage_bytes between 5242880 and 1000000000)
);
insert into public.cloud_storage_limits(singleton) values(true);
alter table public.cloud_storage_limits enable row level security;
revoke all on public.cloud_storage_limits from anon,authenticated;

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
    or (is_supabase and (requested_bytes>5242880 or new.state<>'active' or new.expires_at<=now()
      or new.expires_at>now()+interval '24 hours')) then
    raise exception 'Invalid upload descriptor' using errcode='22023';
  end if;
  select coalesce((settings->>'maxStorageBytes')::bigint,case when is_supabase then 1000000000 else 10737418240 end)
    into quota_bytes from public.libraries where id=new.library_id;
  select coalesce(sum(size_bytes),0) into used_bytes from public.blobs where library_id=new.library_id;
  select coalesce(sum(case when s.descriptor->>'storageBackend'='supabase' then
    coalesce((o.metadata->>'size')::bigint,5242880) else (s.descriptor->>'sizeBytes')::bigint end),0)
    into reserved_bytes from public.cloud_upload_sessions s
    left join storage.objects o on o.bucket_id='lattice-shared-library' and o.name=s.descriptor->>'key'
    where s.library_id=new.library_id and s.state='active'
      and (s.descriptor->>'storageBackend'='supabase' or s.expires_at>now())
      and not exists(select 1 from public.blobs b where b.storage_key=s.descriptor->>'key');
  -- Reserve the whole bucket file limit, so even a direct Storage API request
  -- cannot turn a tiny declared upload into an unaccounted 5MiB object.
  if used_bytes+reserved_bytes+(case when is_supabase then 5242880 else requested_bytes end)>quota_bytes then
    raise exception 'Library storage quota exceeded' using errcode='P0001';
  end if;
  if is_supabase then
    select max_storage_bytes into service_quota from public.cloud_storage_limits where singleton;
    select coalesce(sum(coalesce((metadata->>'size')::bigint,1000000000)),0) into object_bytes from storage.objects;
    select coalesce(sum(5242880),0) into service_reserved from public.cloud_upload_sessions s
      where s.state='active' and s.descriptor->>'storageBackend'='supabase'
      and not exists(select 1 from storage.objects o where o.bucket_id='lattice-shared-library' and o.name=s.descriptor->>'key');
    if object_bytes+service_reserved+5242880>service_quota then
      raise exception 'Service storage quota exceeded' using errcode='P0001';
    end if;
  end if;
  return new;
end $$;

create or replace function public.cloud_guard_upload_state()
returns trigger language plpgsql security definer set search_path=public,storage as $$
begin
  if new.id<>old.id or new.library_id<>old.library_id or new.user_id<>old.user_id or new.descriptor<>old.descriptor or new.expires_at<>old.expires_at then
    raise exception 'Upload descriptor is immutable' using errcode='42501'; end if;
  if old.state<>'active' and new.state<>old.state then raise exception 'Upload state is terminal' using errcode='42501'; end if;
  if new.state='complete' and not exists(select 1 from public.blobs where storage_key=new.descriptor->>'key' and library_id=new.library_id) then
    raise exception 'Upload completion requires registered blob' using errcode='42501'; end if;
  if new.state='aborted' and new.descriptor->>'storageBackend'='supabase' and (
    exists(select 1 from storage.objects where bucket_id='lattice-shared-library' and name=new.descriptor->>'key')
    or exists(select 1 from public.blobs where storage_key=new.descriptor->>'key')) then
    raise exception 'Delete uncommitted bytes through Storage API before releasing capacity' using errcode='42501'; end if;
  return new;
end $$;

create function public.cloud_guard_storage_session_delete()
returns trigger language plpgsql security definer set search_path=public,storage as $$
begin
  if old.descriptor->>'storageBackend'='supabase' and (old.state='active' or
    exists(select 1 from storage.objects where bucket_id='lattice-shared-library' and name=old.descriptor->>'key')) then
    raise exception 'Abort and clean storage before deleting session' using errcode='42501'; end if;
  return old;
end $$;
create trigger cloud_guard_storage_session_delete before delete on public.cloud_upload_sessions
  for each row execute function public.cloud_guard_storage_session_delete();

-- Admins can clean abandoned uploads after a member leaves. The Worker normal
-- upload routes still bind sessions to their creator; cleanup is the exception.
drop policy cloud_upload_read on public.cloud_upload_sessions;
create policy cloud_upload_read on public.cloud_upload_sessions for select to authenticated using (
  (user_id=auth.uid() and public.has_library_role(library_id,auth.uid(),'editor'))
  or public.has_library_role(library_id,auth.uid(),'admin'));
drop policy cloud_upload_update on public.cloud_upload_sessions;
create policy cloud_upload_update on public.cloud_upload_sessions for update to authenticated
using((user_id=auth.uid() and public.has_library_role(library_id,auth.uid(),'editor')) or public.has_library_role(library_id,auth.uid(),'admin'))
with check((user_id=auth.uid() and public.has_library_role(library_id,auth.uid(),'editor')) or (state='aborted' and public.has_library_role(library_id,auth.uid(),'admin')));

create function public.cloud_storage_can_insert(p_bucket text,p_name text,p_metadata jsonb)
returns boolean language sql stable security definer set search_path=public,storage as $$
select p_bucket='lattice-shared-library' and exists (
  select 1 from public.cloud_upload_sessions s where s.descriptor->>'key'=p_name
    and s.descriptor->>'storageBackend'='supabase' and s.user_id=auth.uid()
    and s.state='active' and s.expires_at>now() and public.has_library_role(s.library_id,auth.uid(),'editor')
    and not exists(select 1 from public.blobs b where b.storage_key=p_name)
    -- Storage authorization probes can precede size metadata. The fixed 5MiB
    -- bucket limit plus full-size reservation remain authoritative in that case.
    and (coalesce(p_metadata->>'size',p_metadata->>'contentLength') is null or
      coalesce(p_metadata->>'size',p_metadata->>'contentLength')=s.descriptor->>'sizeBytes'));
$$;

create function public.cloud_storage_can_read(p_bucket text,p_name text)
returns boolean language sql stable security definer set search_path=public,storage as $$
select p_bucket='lattice-shared-library' and (
  exists(select 1 from public.blobs b where b.storage_key=p_name and b.storage_backend='supabase'
    and public.has_library_role(b.library_id,auth.uid(),'viewer'))
  or exists(select 1 from public.cloud_upload_sessions s where s.descriptor->>'key'=p_name
    and s.descriptor->>'storageBackend'='supabase' and s.state='active'
    and ((s.user_id=auth.uid() and public.has_library_role(s.library_id,auth.uid(),'editor'))
      or public.has_library_role(s.library_id,auth.uid(),'admin'))));
$$;

create function public.cloud_storage_can_delete(p_bucket text,p_name text)
returns boolean language plpgsql volatile security definer set search_path=public,storage as $$
declare upload public.cloud_upload_sessions;
begin
  if p_bucket<>'lattice-shared-library' then return false; end if;
  -- Finalization locks the same session. Cleanup cannot delete committed bytes.
  select * into upload from public.cloud_upload_sessions where descriptor->>'key'=p_name
    and descriptor->>'storageBackend'='supabase' for update;
  if upload.id is null then return false; end if;
  return not exists(select 1 from public.blobs where storage_key=p_name)
    and ((upload.user_id=auth.uid() and public.has_library_role(upload.library_id,auth.uid(),'editor'))
      or public.has_library_role(upload.library_id,auth.uid(),'admin'));
end $$;

revoke all on function public.cloud_storage_can_insert(text,text,jsonb),public.cloud_storage_can_read(text,text),public.cloud_storage_can_delete(text,text) from public,anon;
grant execute on function public.cloud_storage_can_insert(text,text,jsonb),public.cloud_storage_can_read(text,text),public.cloud_storage_can_delete(text,text) to authenticated;
create policy lattice_cloud_storage_insert on storage.objects for insert to authenticated
with check(public.cloud_storage_can_insert(bucket_id,name,metadata));
create policy lattice_cloud_storage_read on storage.objects for select to authenticated
using(public.cloud_storage_can_read(bucket_id,name));
create policy lattice_cloud_storage_delete on storage.objects for delete to authenticated
using(public.cloud_storage_can_delete(bucket_id,name));
-- No UPDATE policy: neither pending nor committed objects may be overwritten.

create or replace function public.cloud_guard_blob_descriptor()
returns trigger language plpgsql security definer set search_path=public,storage as $$
begin
  if tg_op='UPDATE' then
    if new.library_id<>old.library_id or new.storage_key<>old.storage_key or new.size_bytes<>old.size_bytes
      or new.sha256<>old.sha256 or new.storage_backend<>old.storage_backend then
      raise exception 'Blob content metadata is immutable' using errcode='42501'; end if;
  elsif new.size_bytes<0 or new.sha256 !~ '^[a-f0-9]{64}$' or new.uploaded_by is distinct from auth.uid()
    or not exists(select 1 from public.cloud_upload_sessions where library_id=new.library_id and user_id=auth.uid()
      and descriptor->>'key'=new.storage_key and coalesce(descriptor->>'storageBackend','r2')=new.storage_backend
      and (descriptor->>'sizeBytes')::bigint=new.size_bytes and state='active' and expires_at>now())
    or (new.storage_backend='supabase' and not exists(select 1 from storage.objects where bucket_id='lattice-shared-library'
      and name=new.storage_key and (metadata->>'size')::bigint=new.size_bytes)) then
    raise exception 'Blob must match an authorized persisted upload' using errcode='42501';
  end if;
  return new;
end $$;

create function public.cloud_complete_storage_upload(p_upload_id uuid,p_sha256 text)
returns uuid language plpgsql security definer set search_path=public,storage as $$
declare upload public.cloud_upload_sessions; prior public.blobs; result_id uuid;
begin
  select * into upload from public.cloud_upload_sessions where id=p_upload_id for update;
  if upload.id is null or upload.user_id is distinct from auth.uid() or upload.descriptor->>'storageBackend'<>'supabase'
    or not public.has_library_role(upload.library_id,auth.uid(),'editor') then
    raise exception 'Upload permission denied' using errcode='42501'; end if;
  select * into prior from public.blobs where storage_key=upload.descriptor->>'key';
  if prior.id is not null then
    if prior.sha256<>p_sha256 then raise exception 'Upload replay hash mismatch' using errcode='22023'; end if;
    return prior.id;
  end if;
  if upload.state<>'active' or upload.expires_at<=now() or p_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Upload is expired or invalid' using errcode='22023'; end if;
  insert into public.blobs(library_id,storage_key,size_bytes,sha256,mime_type,uploaded_by,storage_backend)
  values(upload.library_id,upload.descriptor->>'key',(upload.descriptor->>'sizeBytes')::bigint,p_sha256,
    upload.descriptor->>'mimeType',auth.uid(),'supabase') returning id into result_id;
  update public.cloud_upload_sessions set state='complete' where id=p_upload_id;
  return result_id;
end $$;
revoke all on function public.cloud_complete_storage_upload(uuid,text) from public,anon;
grant execute on function public.cloud_complete_storage_upload(uuid,text) to authenticated;

create or replace function public.cloud_library_usage(p_library_id uuid)
returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare used_bytes bigint; reserved_bytes bigint; quota_bytes bigint; service_used bigint; service_reserved bigint; service_quota bigint;
begin
  if not public.has_library_role(p_library_id,auth.uid(),'viewer') then raise exception 'Membership required' using errcode='42501'; end if;
  select coalesce((settings->>'maxStorageBytes')::bigint,1000000000) into quota_bytes from public.libraries where id=p_library_id;
  select coalesce(sum(size_bytes),0) into used_bytes from public.blobs where library_id=p_library_id;
  select coalesce(sum(case when s.descriptor->>'storageBackend'='supabase' then coalesce((o.metadata->>'size')::bigint,5242880)
    else (s.descriptor->>'sizeBytes')::bigint end),0) into reserved_bytes from public.cloud_upload_sessions s
    left join storage.objects o on o.bucket_id='lattice-shared-library' and o.name=s.descriptor->>'key'
    where s.library_id=p_library_id and s.state='active' and (s.descriptor->>'storageBackend'='supabase' or s.expires_at>now())
    and not exists(select 1 from public.blobs b where b.storage_key=s.descriptor->>'key');
  select coalesce(sum(coalesce((metadata->>'size')::bigint,1000000000)),0) into service_used from storage.objects;
  select coalesce(sum(5242880),0) into service_reserved from public.cloud_upload_sessions s where s.state='active'
    and s.descriptor->>'storageBackend'='supabase' and not exists(select 1 from storage.objects o
      where o.bucket_id='lattice-shared-library' and o.name=s.descriptor->>'key');
  select max_storage_bytes into service_quota from public.cloud_storage_limits where singleton;
  return jsonb_build_object('usedBytes',used_bytes,'reservedBytes',reserved_bytes,'maxStorageBytes',quota_bytes,
    'supabaseService',jsonb_build_object('usedBytes',service_used,'reservedBytes',service_reserved,'maxStorageBytes',service_quota));
end $$;
