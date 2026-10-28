-- Immutable collaboration history starts when this migration is applied.
-- Existing mutable change feeds remain sync projections, never audit evidence.
-- Deliberately no cascading foreign keys: deleting content must retain evidence.
create table public.cloud_audit_events (
  sequence bigint generated always as identity primary key,
  library_id uuid not null,
  actor_id uuid,
  actor_display_name text,
  entity_type text not null check(entity_type in ('library','collection','item','version','annotation','comment','member')),
  entity_id uuid not null,
  item_id uuid,
  version_id uuid,
  annotation_id uuid,
  visibility_owner_id uuid,
  action text not null check(action in ('created','updated','deleted','trashed','restored','role-changed','status-changed')),
  target_label text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default statement_timestamp()
);
create index cloud_audit_events_library_sequence on public.cloud_audit_events(library_id,sequence desc);
create index cloud_audit_events_annotation on public.cloud_audit_events(annotation_id) where annotation_id is not null;
alter table public.cloud_audit_events enable row level security;
revoke all on public.cloud_audit_events from public, anon, authenticated;
grant select on public.cloud_audit_events to authenticated;
revoke all on sequence public.cloud_audit_events_sequence_seq from public, anon, authenticated;

-- Existing annotations are shared. Honor explicit private markers defensively
-- without treating local viewer filters as a security boundary.
create function public.cloud_audit_private_owner(p jsonb) returns uuid
language sql immutable set search_path=public as $$
  select case when p->>'visibility'='private' or p#>>'{body,visibility}'='private' or p#>>'{body,private}'='true'
    then (p->>'author_id')::uuid else null end;
$$;
create function public.cloud_audit_annotation_visible(p_annotation_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select not exists(select 1 from public.annotations a where a.id=p_annotation_id
    and public.cloud_audit_private_owner(to_jsonb(a)) is not null and a.author_id<>auth.uid())
    -- Retain the strict historical audience even after the source annotation
    -- is removed or made shared again; immutable private evidence stays private.
    and not exists(select 1 from public.cloud_audit_events e where e.annotation_id=p_annotation_id
      and e.visibility_owner_id is not null and e.visibility_owner_id<>auth.uid());
$$;
revoke all on function public.cloud_audit_private_owner(jsonb) from public,anon,authenticated;
revoke all on function public.cloud_audit_annotation_visible(uuid) from public,anon;
grant execute on function public.cloud_audit_annotation_visible(uuid) to authenticated;
create policy cloud_audit_events_member_read on public.cloud_audit_events for select to authenticated
using(public.is_library_member(library_id,auth.uid())
  and (visibility_owner_id is null or visibility_owner_id=auth.uid())
  and (annotation_id is null or public.cloud_audit_annotation_visible(annotation_id)));

create function public.cloud_audit_immutable() returns trigger
language plpgsql set search_path=public as $$
begin
  raise exception 'Audit history is immutable' using errcode='42501';
end $$;
create trigger cloud_audit_events_immutable before update or delete on public.cloud_audit_events
for each row execute function public.cloud_audit_immutable();
revoke all on function public.cloud_audit_immutable() from public,anon,authenticated;

-- Explicit snapshots exclude settings, invitation credentials, blob paths,
-- arbitrary item metadata, preview images, and version manifests. Historical
-- file content is referenced through existing immutable item_versions.
create function public.cloud_audit_snapshot(p_table text,p jsonb) returns jsonb
language sql immutable set search_path=public as $$
  select case when p is null then null else case p_table
    when 'libraries' then jsonb_build_object('id',p->'id','name',p->'name','slug',p->'slug','description',p->'description','visibility',p->'visibility','archived_at',p->'archived_at')
    when 'collections' then jsonb_build_object('id',p->'id','name',p->'name','parent_collection_id',p->'parent_collection_id','sort_key',p->'sort_key')
    when 'items' then jsonb_build_object('id',p->'id','title',p->'title','canonical_name',p->'canonical_name','kind',p->'kind','collection_id',p->'collection_id','parent_item_id',p#>'{metadata,parentItemId}','status',p->'status','current_version_id',p->'current_version_id','content_hash',p->'content_hash','deleted_at',p->'deleted_at')
    when 'item_versions' then jsonb_build_object('id',p->'id','item_id',p->'item_id','version_number',p->'version_number','base_version_id',p->'base_version_id','content_hash',p->'content_hash')
    when 'annotations' then jsonb_build_object('id',p->'id','item_id',p->'item_id','version_id',p->'version_id','author_id',p->'author_id','kind',p->'kind','target',p->'target','quote',p->'quote','geometry',p->'geometry','style',p->'style','body',jsonb_build_object('comment',p#>'{body,comment}','tags',p#>'{body,tags}','formula',p#>'{body,formula}'),'status',p->'status','revision',p->'revision','deleted_at',p->'deleted_at')
    when 'annotation_comments' then jsonb_build_object('id',p->'id','annotation_id',p->'annotation_id','author_id',p->'author_id','body',p->'body','parent_id',p->'parent_id','deleted_at',p->'deleted_at')
    when 'library_members' then jsonb_build_object('user_id',p->'user_id','role',p->'role','status',p->'status','display_name',p->'display_name')
    else null end end;
$$;
revoke all on function public.cloud_audit_snapshot(text,jsonb) from public,anon,authenticated;

create function public.cloud_record_audit() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  prior jsonb; current_row jsonb; source jsonb; before_value jsonb; after_value jsonb;
  target_library uuid; target_item uuid; target_version uuid; target_annotation uuid;
  target_entity uuid; entity text; verb text; label text; actor_label text; private_owner uuid; annotation_row jsonb;
begin
  if tg_op<>'INSERT' then prior:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then current_row:=to_jsonb(new); end if;
  source:=coalesce(current_row,prior);
  before_value:=public.cloud_audit_snapshot(tg_table_name,prior);
  after_value:=public.cloud_audit_snapshot(tg_table_name,current_row);
  -- Heartbeats, settings-only writes, and timestamp-only writes are not content changes.
  if before_value is not distinct from after_value then return coalesce(new,old); end if;
  target_entity:=(source->>'id')::uuid;
  verb:=case tg_op when 'INSERT' then 'created' when 'DELETE' then 'deleted' else 'updated' end;
  if tg_table_name='libraries' then
    target_library:=target_entity; entity:='library'; label:=source->>'name';
  elsif tg_table_name='library_members' then
    target_library:=(source->>'library_id')::uuid; target_entity:=(source->>'user_id')::uuid; entity:='member';
    label:=coalesce(source->>'display_name',source->>'user_id');
    if tg_op='UPDATE' and prior->>'role' is distinct from current_row->>'role' then verb:='role-changed';
    elsif tg_op='UPDATE' and prior->>'status' is distinct from current_row->>'status' then verb:='status-changed'; end if;
  elsif tg_table_name='collections' then
    target_library:=(source->>'library_id')::uuid; entity:='collection'; label:=source->>'name';
  elsif tg_table_name='items' then
    target_library:=(source->>'library_id')::uuid; target_item:=target_entity; target_version:=(source->>'current_version_id')::uuid;
    entity:='item'; label:=source->>'title';
    if tg_op='UPDATE' and current_row->>'status'='trashed' and prior->>'status'<>'trashed' then verb:='trashed';
    elsif tg_op='UPDATE' and prior->>'status'='trashed' and current_row->>'status'<>'trashed' then verb:='restored'; end if;
  elsif tg_table_name='item_versions' then
    entity:='version'; target_version:=target_entity; target_item:=(source->>'item_id')::uuid;
  elsif tg_table_name='annotations' then
    entity:='annotation'; target_annotation:=target_entity; target_item:=(source->>'item_id')::uuid; target_version:=(source->>'version_id')::uuid;
    private_owner:=coalesce(public.cloud_audit_private_owner(prior),public.cloud_audit_private_owner(current_row));
    if tg_op='UPDATE' and current_row->>'status'='deleted' and prior->>'status'<>'deleted' then verb:='deleted'; end if;
  elsif tg_table_name='annotation_comments' then
    entity:='comment'; target_annotation:=(source->>'annotation_id')::uuid;
    select to_jsonb(a) into annotation_row from public.annotations a where a.id=target_annotation;
    if annotation_row is not null then
      target_item:=(annotation_row->>'item_id')::uuid; target_version:=(annotation_row->>'version_id')::uuid;
      private_owner:=public.cloud_audit_private_owner(annotation_row);
    else
      select e.item_id,e.version_id,e.library_id,e.visibility_owner_id into target_item,target_version,target_library,private_owner
      from public.cloud_audit_events e where e.annotation_id=target_annotation and e.entity_type='annotation' order by e.sequence desc limit 1;
    end if;
    if tg_op='UPDATE' and current_row->>'deleted_at' is not null and prior->>'deleted_at' is null then verb:='deleted'; end if;
  end if;
  if target_item is not null then
    select i.library_id,i.title into target_library,label from public.items i where i.id=target_item;
    if target_library is null then
      -- A cascading parent delete has already recorded its immutable identity.
      select e.library_id,e.target_label into target_library,label from public.cloud_audit_events e
      where e.entity_type='item' and e.entity_id=target_item order by e.sequence desc limit 1;
    end if;
  end if;
  if target_library is null then raise exception 'Audit parent identity unavailable' using errcode='23503'; end if;
  -- Same lock as sync changes, so a page cursor cannot skip an earlier commit.
  perform pg_advisory_xact_lock(hashtextextended(target_library::text,2));
  select display_name into actor_label from public.library_members where library_id=target_library and user_id=auth.uid();
  insert into public.cloud_audit_events(library_id,actor_id,actor_display_name,entity_type,entity_id,item_id,version_id,annotation_id,visibility_owner_id,action,target_label,before,after)
  values(target_library,auth.uid(),actor_label,entity,target_entity,target_item,target_version,target_annotation,private_owner,verb,left(coalesce(label,entity),240),before_value,after_value);
  return coalesce(new,old);
end $$;
revoke all on function public.cloud_record_audit() from public,anon,authenticated;

create trigger cloud_audit_library after insert or update on public.libraries for each row execute function public.cloud_record_audit();
create trigger cloud_audit_library_delete before delete on public.libraries for each row execute function public.cloud_record_audit();
create trigger cloud_audit_collection after insert or update on public.collections for each row execute function public.cloud_record_audit();
create trigger cloud_audit_collection_delete before delete on public.collections for each row execute function public.cloud_record_audit();
create trigger cloud_audit_item after insert or update on public.items for each row execute function public.cloud_record_audit();
create trigger cloud_audit_item_delete before delete on public.items for each row execute function public.cloud_record_audit();
create trigger cloud_audit_version after insert or update on public.item_versions for each row execute function public.cloud_record_audit();
create trigger cloud_audit_version_delete before delete on public.item_versions for each row execute function public.cloud_record_audit();
create trigger cloud_audit_annotation after insert or update on public.annotations for each row execute function public.cloud_record_audit();
create trigger cloud_audit_annotation_delete before delete on public.annotations for each row execute function public.cloud_record_audit();
create trigger cloud_audit_comment after insert or update on public.annotation_comments for each row execute function public.cloud_record_audit();
create trigger cloud_audit_comment_delete before delete on public.annotation_comments for each row execute function public.cloud_record_audit();
create trigger cloud_audit_member after insert or update on public.library_members for each row execute function public.cloud_record_audit();
create trigger cloud_audit_member_delete before delete on public.library_members for each row execute function public.cloud_record_audit();
