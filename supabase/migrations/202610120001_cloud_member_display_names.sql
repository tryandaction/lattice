-- Nicknames remain scoped to a library and may only be set by their owner.
alter table public.library_members add column if not exists display_name text;
alter table public.library_members add constraint library_member_display_name_length
  check (display_name is null or char_length(display_name) between 1 and 60);

create or replace function public.cloud_set_member_display_name(p_library_id uuid, p_display_name text)
returns public.library_members language plpgsql security definer set search_path=public as $$
declare result public.library_members; clean_name text := btrim(p_display_name);
begin
  if auth.uid() is null or clean_name is null or char_length(clean_name) not between 1 and 60 then
    raise exception 'Nickname must contain 1-60 characters' using errcode='22023';
  end if;
  update public.library_members set display_name=clean_name, updated_at=now()
    where library_id=p_library_id and user_id=auth.uid() and status='active' returning * into result;
  if result.user_id is null then raise exception 'Active membership required' using errcode='42501'; end if;
  return result;
end $$;
revoke all on function public.cloud_set_member_display_name(uuid,text) from public,anon;
grant execute on function public.cloud_set_member_display_name(uuid,text) to authenticated;

create or replace function public.cloud_guard_member_display_name()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.display_name is distinct from old.display_name and (auth.uid() is null or old.user_id<>auth.uid()) then
    raise exception 'Only the member may change their nickname' using errcode='42501';
  end if;
  return new;
end $$;
create trigger cloud_member_display_name_before_update before update on public.library_members
  for each row execute function public.cloud_guard_member_display_name();

-- Capture the verified author's label once. Caller-supplied labels cannot impersonate members.
create or replace function public.cloud_annotation_author_label()
returns trigger language plpgsql security definer set search_path=public as $$
declare label text;
begin
  if tg_op='INSERT' then
    select m.display_name into label from public.library_members m join public.items i on i.library_id=m.library_id
      where i.id=new.item_id and m.user_id=new.author_id;
    new.body := (coalesce(new.body,'{}'::jsonb) - 'authorDisplayName') || case when label is null then '{}'::jsonb else jsonb_build_object('authorDisplayName',label) end;
  else
    new.body := (coalesce(new.body,'{}'::jsonb) - 'authorDisplayName') || case when old.body ? 'authorDisplayName' then jsonb_build_object('authorDisplayName',old.body->>'authorDisplayName') else '{}'::jsonb end;
  end if;
  return new;
end $$;
create trigger cloud_annotation_author_label_before_write before insert or update on public.annotations
  for each row execute function public.cloud_annotation_author_label();
