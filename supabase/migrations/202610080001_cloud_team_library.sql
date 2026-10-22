-- Apply after all three existing migrations. No service-role is used by the client/Worker.
-- Preflight duplicate active sibling names before creating this index; never delete user records.
create unique index if not exists cloud_items_sibling_name
  on public.items(library_id, (coalesce(metadata->>'parentItemId', '')), canonical_name)
  where status <> 'trashed';

create or replace function public.cloud_validate_item_parent()
returns trigger language plpgsql security definer set search_path = public as $$
declare parent_id uuid; ancestor uuid; seen uuid[] := array[new.id];
begin
  if new.canonical_name = '' or new.canonical_name ~ '(^/|\\|[[:cntrl:]])'
     or new.canonical_name ~ '(^|/)\.\.?(/|$)' then raise exception 'Unsafe item path' using errcode = '22023'; end if;
  if new.metadata->>'parentItemId' is not null then
    parent_id := (new.metadata->>'parentItemId')::uuid;
    if tg_op='INSERT' and new.metadata->>'expectedParentVersion' is not null then
      perform 1 from public.items where id=parent_id and library_id=new.library_id and current_version_id=(new.metadata->>'expectedParentVersion')::uuid for update;
      if not found then raise exception 'Parent version changed' using errcode='40001'; end if;
    end if;
    ancestor := parent_id;
    -- Serialize parent moves within a library to prevent two concurrent changes forming a cycle.
    perform pg_advisory_xact_lock(hashtextextended(new.library_id::text, 0));
    while ancestor is not null loop
      if ancestor = any(seen) then raise exception 'Cyclic item parent' using errcode = '22023'; end if;
      seen := array_append(seen, ancestor);
      if not exists(select 1 from public.items where id=ancestor and library_id=new.library_id and status='active') then
        raise exception 'Parent must belong to same active library' using errcode = '42501';
      end if;
      select (metadata->>'parentItemId')::uuid into ancestor from public.items where id=ancestor;
    end loop;
  end if;
  return new;
end $$;
create trigger cloud_validate_item_parent before insert or update of metadata, canonical_name, library_id on public.items
for each row execute function public.cloud_validate_item_parent();

create or replace function public.cloud_project_item_child()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.item_children where child_item_id=new.id;
  if new.metadata->>'parentItemId' is not null then
    insert into public.item_children(parent_item_id,child_item_id,relative_path,kind,sort_key)
    values((new.metadata->>'parentItemId')::uuid,new.id,new.canonical_name,new.kind,new.canonical_name);
  end if;
  return new;
end $$;
create trigger cloud_project_item_child after insert or update of metadata,canonical_name on public.items
for each row execute function public.cloud_project_item_child();

-- CAS applies to every insertion, including direct PostgREST, not merely the Worker endpoint.
create or replace function public.cloud_guard_version()
returns trigger language plpgsql security definer set search_path = public as $$
declare current_item public.items; source_blob public.blobs;
begin
  select * into current_item from public.items where id=new.item_id for update;
  if current_item.id is null or not public.has_library_role(current_item.library_id,auth.uid(),'editor') then
    raise exception 'Version permission denied' using errcode='42501'; end if;
  if current_item.status='trashed' or current_item.current_version_id is distinct from new.base_version_id then
    raise exception 'Version conflict: base changed' using errcode='40001'; end if;
  select * into source_blob from public.blobs where id=new.blob_id and deleted_at is null;
  if source_blob.id is null or source_blob.library_id <> current_item.library_id or source_blob.sha256 <> new.content_hash then
    raise exception 'Blob library or hash mismatch' using errcode='22023'; end if;
  new.created_by := auth.uid();
  new.version_number := coalesce((select max(version_number) from public.item_versions where item_id=new.item_id),0)+1;
  return new;
end $$;
create trigger cloud_guard_version before insert on public.item_versions for each row execute function public.cloud_guard_version();

create or replace function public.cloud_project_version()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.items set current_version_id=new.id,content_hash=new.content_hash,updated_at=now() where id=new.item_id;
  -- Old extracted text must never remain associated with a new version.
  delete from public.search_documents where item_id=new.item_id;
  insert into public.search_documents(library_id,item_id,source_type,title,body,locator)
  select library_id,id,'item',title,'',jsonb_build_object('versionId',new.id,'extraction','not-extracted') from public.items where id=new.item_id;
  return new;
end $$;
create trigger cloud_project_version after insert on public.item_versions for each row execute function public.cloud_project_version();

create or replace function public.cloud_commit_version(p_item_id uuid,p_id uuid,p_blob_id uuid,p_hash text,p_manifest jsonb,p_base_id uuid)
returns public.item_versions language plpgsql security invoker set search_path=public as $$
declare result public.item_versions;
begin
  perform 1 from public.items where id=p_item_id for update;
  select * into result from public.item_versions where id=p_id;
  if result.id is not null then
    if result.item_id<>p_item_id or result.content_hash<>p_hash or result.blob_id<>p_blob_id then
      raise exception 'Idempotency payload mismatch' using errcode='22023'; end if;
    return result;
  end if;
  insert into public.item_versions(id,item_id,blob_id,content_hash,manifest,base_version_id,created_by,version_number)
    values(p_id,p_item_id,p_blob_id,p_hash,p_manifest,p_base_id,auth.uid(),1) returning * into result;
  return result;
end $$;
revoke all on function public.cloud_commit_version(uuid,uuid,uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.cloud_commit_version(uuid,uuid,uuid,text,jsonb,uuid) to authenticated;

-- Only the verified current version is indexed. Body is explicit text, never a binary/base64 payload.
create or replace function public.cloud_index_text(p_item_id uuid,p_version_id uuid,p_text text)
returns void language plpgsql security definer set search_path=public as $$
declare current_item public.items;
begin
  select * into current_item from public.items where id=p_item_id for update;
  if not public.has_library_role(current_item.library_id,auth.uid(),'editor') then raise exception 'Index permission denied' using errcode='42501'; end if;
  if current_item.current_version_id<>p_version_id or octet_length(p_text)>1048576 then raise exception 'Index version or size invalid' using errcode='22023'; end if;
  delete from public.search_documents where item_id=p_item_id;
  insert into public.search_documents(library_id,item_id,source_type,title,body,locator)
  values(current_item.library_id,p_item_id,'file',current_item.title,p_text,jsonb_build_object('versionId',p_version_id,'section','full-text','extraction','text'));
end $$;
revoke all on function public.cloud_index_text(uuid,uuid,text) from public,anon;
grant execute on function public.cloud_index_text(uuid,uuid,text) to authenticated;

-- Upload descriptors are authoritative database records, not unsigned client-provided object keys.
create table public.cloud_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  descriptor jsonb not null,
  expires_at timestamptz not null default now()+interval '24 hours',
  created_at timestamptz not null default now()
);
alter table public.cloud_upload_sessions enable row level security;
create policy cloud_upload_read on public.cloud_upload_sessions for select to authenticated
 using (user_id=auth.uid() and public.has_library_role(library_id,auth.uid(),'editor'));
create policy cloud_upload_insert on public.cloud_upload_sessions for insert to authenticated
 with check(user_id=auth.uid() and public.has_library_role(library_id,auth.uid(),'editor'));
create policy cloud_upload_delete on public.cloud_upload_sessions for delete to authenticated
 using(user_id=auth.uid() and public.has_library_role(library_id,auth.uid(),'editor'));
alter table public.cloud_upload_sessions add column state text not null default 'active' check(state in ('active','complete','aborted'));
create policy cloud_upload_update on public.cloud_upload_sessions for update to authenticated
 using(user_id=auth.uid() and public.has_library_role(library_id,auth.uid(),'editor'))
 with check(user_id=auth.uid() and public.has_library_role(library_id,auth.uid(),'editor'));

create or replace function public.cloud_guard_upload_quota()
returns trigger language plpgsql security definer set search_path=public as $$
declare used_bytes bigint; reserved_bytes bigint; quota_bytes bigint; requested_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.library_id::text,1));
  requested_bytes := (new.descriptor->>'sizeBytes')::bigint;
  if requested_bytes<0 or requested_bytes>104857600 or new.descriptor->>'libraryId'<>new.library_id::text
    or not starts_with(new.descriptor->>'key','libraries/'||new.library_id::text||'/blobs/') then
    raise exception 'Invalid upload descriptor' using errcode='22023';
  end if;
  select coalesce((settings->>'maxStorageBytes')::bigint,10737418240) into quota_bytes from public.libraries where id=new.library_id;
  select coalesce(sum(size_bytes),0) into used_bytes from public.blobs where library_id=new.library_id and deleted_at is null;
  select coalesce(sum((descriptor->>'sizeBytes')::bigint),0) into reserved_bytes from public.cloud_upload_sessions s
    where library_id=new.library_id and state='active' and expires_at>now()
    and not exists(select 1 from public.blobs b where b.storage_key=s.descriptor->>'key' and b.deleted_at is null);
  if used_bytes+reserved_bytes+requested_bytes>quota_bytes then raise exception 'Library storage quota exceeded' using errcode='P0001'; end if;
  return new;
end $$;
create trigger cloud_guard_upload_quota before insert on public.cloud_upload_sessions for each row execute function public.cloud_guard_upload_quota();

create or replace function public.cloud_guard_upload_state()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.id<>old.id or new.library_id<>old.library_id or new.user_id<>old.user_id or new.descriptor<>old.descriptor or new.expires_at<>old.expires_at then raise exception 'Upload descriptor is immutable' using errcode='42501'; end if;
  if old.state<>'active' and new.state<>old.state then raise exception 'Upload state is terminal' using errcode='42501'; end if;
  if new.state='complete' and not exists(select 1 from public.blobs where storage_key=new.descriptor->>'key' and library_id=new.library_id) then raise exception 'Upload completion requires registered blob' using errcode='42501'; end if;
  return new;
end $$;
create trigger cloud_guard_upload_state before update on public.cloud_upload_sessions for each row execute function public.cloud_guard_upload_state();

create or replace function public.cloud_guard_blob_descriptor()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='UPDATE' then
    if new.library_id<>old.library_id or new.storage_key<>old.storage_key or new.size_bytes<>old.size_bytes or new.sha256<>old.sha256 then raise exception 'Blob content metadata is immutable' using errcode='42501'; end if;
  elsif new.size_bytes<0 or new.sha256 !~ '^[a-f0-9]{64}$' or not exists(select 1 from public.cloud_upload_sessions where library_id=new.library_id and user_id=auth.uid() and descriptor->>'key'=new.storage_key and (descriptor->>'sizeBytes')::bigint=new.size_bytes and state='active') then
    raise exception 'Blob must match an authorized upload plan' using errcode='42501';
  end if;
  return new;
end $$;
create trigger cloud_guard_blob_descriptor before insert or update on public.blobs for each row execute function public.cloud_guard_blob_descriptor();

create or replace function public.cloud_library_usage(p_library_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare used_bytes bigint; reserved_bytes bigint; quota_bytes bigint;
begin
  if not public.has_library_role(p_library_id,auth.uid(),'viewer') then raise exception 'Membership required' using errcode='42501'; end if;
  select coalesce((settings->>'maxStorageBytes')::bigint,10737418240) into quota_bytes from public.libraries where id=p_library_id;
  select coalesce(sum(size_bytes),0) into used_bytes from public.blobs where library_id=p_library_id and deleted_at is null;
  select coalesce(sum((descriptor->>'sizeBytes')::bigint),0) into reserved_bytes from public.cloud_upload_sessions s where library_id=p_library_id and state='active' and expires_at>now()
    and not exists(select 1 from public.blobs b where b.storage_key=s.descriptor->>'key' and b.deleted_at is null);
  return jsonb_build_object('usedBytes',used_bytes,'reservedBytes',reserved_bytes,'maxStorageBytes',quota_bytes);
end $$;
revoke all on function public.cloud_library_usage(uuid) from public,anon;
grant execute on function public.cloud_library_usage(uuid) to authenticated;

alter table public.invitations add column if not exists accepted_by uuid references auth.users(id);
-- Existing token column stores only SHA256 for NEW invitations. API never returns its contents.
create or replace function public.cloud_accept_invitation(p_hash text)
returns uuid language plpgsql security definer set search_path=public as $$
declare invitation public.invitations; account_email text;
begin
  if auth.uid() is null then raise exception 'Login required' using errcode='42501'; end if;
  select email into account_email from auth.users where id=auth.uid();
  select * into invitation from public.invitations where token=p_hash for update;
  if invitation.id is null or lower(invitation.email)<>lower(account_email) then raise exception 'Invalid invitation' using errcode='42501'; end if;
  if invitation.status='accepted' and invitation.accepted_by=auth.uid() then
    if not public.is_library_member(invitation.library_id,auth.uid()) then raise exception 'Membership revoked' using errcode='42501'; end if;
    return invitation.library_id;
  end if;
  if invitation.status<>'pending' or invitation.expires_at<=now() then raise exception 'Invitation expired or revoked' using errcode='42501'; end if;
  insert into public.library_members(library_id,user_id,role,status) values(invitation.library_id,auth.uid(),invitation.role,'active')
    on conflict(library_id,user_id) do update set role=excluded.role,status='active',updated_at=now()
    where library_members.role<>'owner';
  update public.invitations set status='accepted',accepted_at=now(),accepted_by=auth.uid() where id=invitation.id;
  return invitation.library_id;
end $$;
revoke all on function public.cloud_accept_invitation(text) from public,anon;
grant execute on function public.cloud_accept_invitation(text) to authenticated;

-- Immutable versions and actor-bound authored records close direct API bypasses.
alter table public.annotations alter column revision set default 1;
drop policy if exists item_versions_update on public.item_versions;
drop policy if exists item_versions_delete on public.item_versions;
create policy item_versions_update on public.item_versions for update to authenticated using(false);
create policy item_versions_delete on public.item_versions for delete to authenticated using(false);
drop policy if exists annotations_insert on public.annotations;
create policy annotations_insert on public.annotations for insert to authenticated with check (
 author_id=auth.uid() and public.has_library_role((select library_id from public.items where id=item_id),auth.uid(),'commenter')
 and exists(select 1 from public.item_versions where id=version_id and item_id=annotations.item_id));

drop policy if exists annotations_update on public.annotations;
-- Annotation writes must go through cloud_mutate_annotation, which checks the
-- revision and source version under a row lock. This prevents direct
-- PostgREST PATCH from becoming an unguarded last-write-wins path.
create policy annotations_update on public.annotations for update to authenticated using(false) with check(false);

drop policy if exists annotation_comments_update on public.annotation_comments;
drop policy if exists annotation_comments_select on public.annotation_comments;
create policy annotation_comments_select on public.annotation_comments for select to authenticated
using(public.is_library_member((select library_id from public.items where id=(select item_id from public.annotations where id=annotation_id)),auth.uid()));
drop policy if exists annotation_comments_insert on public.annotation_comments;
create policy annotation_comments_insert on public.annotation_comments for insert to authenticated
with check(author_id=auth.uid() and public.has_library_role((select library_id from public.items where id=(select item_id from public.annotations where id=annotation_id)),auth.uid(),'commenter'));
create policy annotation_comments_update on public.annotation_comments for update to authenticated
using (
  (author_id=auth.uid() and public.has_library_role((select library_id from public.items where id=(select item_id from public.annotations where id=annotation_id)),auth.uid(),'commenter'))
  or public.has_library_role((select library_id from public.items where id=(select item_id from public.annotations where id=annotation_id)),auth.uid(),'admin')
)
with check (
  (author_id=auth.uid() and public.has_library_role((select library_id from public.items where id=(select item_id from public.annotations where id=annotation_id)),auth.uid(),'commenter'))
  or public.has_library_role((select library_id from public.items where id=(select item_id from public.annotations where id=annotation_id)),auth.uid(),'admin')
);

create or replace function public.cloud_guard_comment_reference()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if char_length(trim(new.body))<1 or char_length(new.body)>20000 then raise exception 'Invalid comment body' using errcode='22023'; end if;
  if tg_op='UPDATE' and (new.author_id<>old.author_id or new.annotation_id<>old.annotation_id) then raise exception 'Comment identity is immutable' using errcode='42501'; end if;
  if new.parent_id is not null and not exists(select 1 from public.annotation_comments where id=new.parent_id and annotation_id=new.annotation_id) then raise exception 'Reply belongs to another annotation' using errcode='22023'; end if;
  return new;
end $$;
create trigger cloud_guard_comment_reference before insert or update on public.annotation_comments for each row execute function public.cloud_guard_comment_reference();

create or replace function public.cloud_update_search_metadata()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='trashed' then delete from public.search_documents where item_id=new.id;
  else update public.search_documents set title=new.title,updated_at=now() where item_id=new.id; end if;
  return new;
end $$;
create trigger cloud_update_search_metadata after update of title,status on public.items for each row execute function public.cloud_update_search_metadata();

create or replace function public.cloud_mutate_annotation(p_item_id uuid,p_annotation jsonb,p_base_revision bigint,p_deleted boolean,p_operation_id uuid)
returns public.annotations language plpgsql security definer set search_path=public as $$
declare current_annotation public.annotations; result public.annotations; target_library uuid; prior_operation public.annotation_operations;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_annotation->>'id',0));
  select library_id into target_library from public.items where id=p_item_id and status<>'trashed';
  if target_library is null or not public.has_library_role(target_library,auth.uid(),'commenter') then raise exception 'Annotation permission denied' using errcode='42501'; end if;
  if (select current_version_id from public.items where id=p_item_id) is distinct from (p_annotation->>'versionId')::uuid then raise exception 'PDF source version changed' using errcode='40001'; end if;
  select * into prior_operation from public.annotation_operations where idempotency_key=p_operation_id::text;
  if prior_operation.id is not null then
    if prior_operation.actor_id<>auth.uid() or prior_operation.annotation_id<>(p_annotation->>'id')::uuid then raise exception 'Operation identity mismatch' using errcode='42501'; end if;
    select * into result from public.annotations where id=prior_operation.annotation_id;
    if result.item_id<>p_item_id then raise exception 'Operation outside requested item' using errcode='42501'; end if;
    return result;
  end if;
  select * into current_annotation from public.annotations where id=(p_annotation->>'id')::uuid for update;
  if current_annotation.id is not null and (current_annotation.item_id<>p_item_id or (current_annotation.author_id<>auth.uid() and not public.has_library_role(target_library,auth.uid(),'admin'))) then
    raise exception 'Annotation author mismatch' using errcode='42501'; end if;
  if coalesce(current_annotation.revision,0)<>p_base_revision then raise exception 'Annotation revision conflict' using errcode='40001'; end if;
  if current_annotation.id is null then
    insert into public.annotations(id,item_id,version_id,author_id,kind,target,quote,geometry,style,body,revision)
    values((p_annotation->>'id')::uuid,p_item_id,(p_annotation->>'versionId')::uuid,auth.uid(),p_annotation->>'kind',p_annotation->'target',p_annotation->'quote',p_annotation->'geometry',coalesce(p_annotation->'style','{}'),coalesce(p_annotation->'body','{}'),1)
    returning * into result;
  else
    update public.annotations set target=p_annotation->'target',quote=p_annotation->'quote',geometry=p_annotation->'geometry',style=p_annotation->'style',body=p_annotation->'body',
      revision=revision+1,status=case when p_deleted then 'deleted' else 'active' end,updated_at=now(),deleted_at=case when p_deleted then now() else null end
      where id=current_annotation.id returning * into result;
  end if;
  insert into public.annotation_operations(annotation_id,operation_type,revision,base_revision,payload,idempotency_key,actor_id)
  values(result.id,case when p_deleted then 'delete' else 'upsert' end,result.revision,p_base_revision,p_annotation,p_operation_id::text,auth.uid());
  return result;
end $$;
revoke all on function public.cloud_mutate_annotation(uuid,jsonb,bigint,boolean,uuid) from public,anon;
grant execute on function public.cloud_mutate_annotation(uuid,jsonb,bigint,boolean,uuid) to authenticated;

create table public.cloud_library_changes (
  sequence bigint generated always as identity primary key,
  library_id uuid not null references public.libraries(id) on delete cascade,
  entity_type text not null check(entity_type in ('item','annotation','comment')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index cloud_library_changes_cursor on public.cloud_library_changes(library_id,sequence);
alter table public.cloud_library_changes enable row level security;
create policy cloud_library_changes_read on public.cloud_library_changes for select to authenticated
using(public.is_library_member(library_id,auth.uid()));

create or replace function public.cloud_record_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare target_library uuid; entity text;
begin
  -- Serialize sequence allocation through commit so an unseen earlier row cannot arrive after a saved cursor.
  if tg_table_name='items' then perform pg_advisory_xact_lock(hashtextextended(new.library_id::text,2)); end if;
  if tg_table_name='items' then target_library:=new.library_id; entity:='item';
  elsif tg_table_name='annotations' then select library_id into target_library from public.items where id=new.item_id; entity:='annotation';
  else select i.library_id into target_library from public.items i join public.annotations a on a.item_id=i.id where a.id=new.annotation_id; entity:='comment'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_library::text,2));
  insert into public.cloud_library_changes(library_id,entity_type,payload) values(target_library,entity,to_jsonb(new));
  return new;
end $$;
create trigger cloud_record_item_change after insert or update on public.items for each row execute function public.cloud_record_change();
create trigger cloud_record_annotation_change after insert or update on public.annotations for each row execute function public.cloud_record_change();
create trigger cloud_record_comment_change after insert or update on public.annotation_comments for each row execute function public.cloud_record_change();
-- One-time bootstrap makes existing tenants visible through the same cursor protocol.
insert into public.cloud_library_changes(library_id,entity_type,payload) select library_id,'item',to_jsonb(i) from public.items i;
insert into public.cloud_library_changes(library_id,entity_type,payload) select i.library_id,'annotation',to_jsonb(a) from public.annotations a join public.items i on i.id=a.item_id;
insert into public.cloud_library_changes(library_id,entity_type,payload) select i.library_id,'comment',to_jsonb(c) from public.annotation_comments c join public.annotations a on a.id=c.annotation_id join public.items i on i.id=a.item_id;
