-- ============================================================================
-- Shared Library security hardening
--
-- This migration closes the bootstrap and ownership holes in the initial RLS
-- migration. It is intentionally additive and can be applied after the core
-- schema and initial policies without rewriting user data.
-- ============================================================================

create or replace function public.is_org_admin(target_organization_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = target_organization_id
      and om.user_id = target_user_id
      and om.status = 'active'
      and om.role in ('owner', 'admin')
  );
$$;

create or replace function public.bootstrap_organization_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.organization_members (organization_id, user_id, role, status)
  values (new.id, new.created_by, 'owner', 'active')
  on conflict (organization_id, user_id) do update
    set role = 'owner', status = 'active', updated_at = now();
  return new;
end;
$$;

drop trigger if exists organizations_bootstrap_owner on public.organizations;
create trigger organizations_bootstrap_owner
after insert on public.organizations
for each row execute function public.bootstrap_organization_owner();

create or replace function public.bootstrap_library_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.library_members (library_id, user_id, role, status)
  values (new.id, new.created_by, 'owner', 'active')
  on conflict (library_id, user_id) do update
    set role = 'owner', status = 'active', updated_at = now();
  return new;
end;
$$;

drop trigger if exists libraries_bootstrap_owner on public.libraries;
create trigger libraries_bootstrap_owner
after insert on public.libraries
for each row execute function public.bootstrap_library_owner();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'item_children_kind_check'
  ) then
    alter table public.item_children add constraint item_children_kind_check check (
      kind in ('pdf', 'markdown', 'code', 'notebook', 'docx', 'pptx', 'image', 'web_snapshot', 'data', 'folder')
    );
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'items_current_version_fk'
  ) then
    alter table public.items add constraint items_current_version_fk
      foreign key (current_version_id) references public.item_versions (id) on delete set null;
  end if;
end;
$$;

-- Rebuild only the policies whose original predicates trusted a self-claimed
-- owner/admin or allowed collaborators to edit another person's content.
drop policy if exists organization_members_insert on public.organization_members;
drop policy if exists organization_members_update on public.organization_members;
drop policy if exists organization_members_delete on public.organization_members;

create policy organization_members_insert on public.organization_members
  for insert to authenticated
  with check (
    public.is_org_admin(organization_id, auth.uid())
    and role in ('admin', 'member')
  );

create policy organization_members_update on public.organization_members
  for update to authenticated
  using (
    public.is_org_admin(organization_id, auth.uid())
    and (role <> 'owner' or exists (
      select 1 from public.organization_members actor
      where actor.organization_id = organization_members.organization_id
        and actor.user_id = auth.uid()
        and actor.role = 'owner'
        and actor.status = 'active'
    ))
  )
  with check (
    role <> 'owner' or exists (
      select 1 from public.organization_members actor
      where actor.organization_id = organization_members.organization_id
        and actor.user_id = auth.uid()
        and actor.role = 'owner'
        and actor.status = 'active'
    )
  );

create policy organization_members_delete on public.organization_members
  for delete to authenticated
  using (
    public.is_org_admin(organization_id, auth.uid())
    and (role <> 'owner' or exists (
      select 1 from public.organization_members actor
      where actor.organization_id = organization_members.organization_id
        and actor.user_id = auth.uid()
        and actor.role = 'owner'
        and actor.status = 'active'
    ))
  );

drop policy if exists libraries_insert on public.libraries;
create policy libraries_insert on public.libraries
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.is_org_member(organization_id, auth.uid())
  );

drop policy if exists library_members_insert on public.library_members;
drop policy if exists library_members_update on public.library_members;
drop policy if exists library_members_delete on public.library_members;

create policy library_members_insert on public.library_members
  for insert to authenticated
  with check (
    public.has_library_role(library_id, auth.uid(), 'admin')
    and role <> 'owner'
  );

create policy library_members_update on public.library_members
  for update to authenticated
  using (
    public.has_library_role(library_id, auth.uid(), 'admin')
    and (role <> 'owner' or public.has_library_role(library_id, auth.uid(), 'owner'))
  )
  with check (
    role <> 'owner' or public.has_library_role(library_id, auth.uid(), 'owner')
  );

create policy library_members_delete on public.library_members
  for delete to authenticated
  using (
    public.has_library_role(library_id, auth.uid(), 'admin')
    and (role <> 'owner' or public.has_library_role(library_id, auth.uid(), 'owner'))
  );

drop policy if exists annotations_update on public.annotations;
create policy annotations_update on public.annotations
  for update to authenticated
  using (
    author_id = auth.uid()
    or public.has_library_role((select library_id from public.items where id = annotations.item_id), auth.uid(), 'admin')
  )
  with check (
    author_id = auth.uid()
    or public.has_library_role((select library_id from public.items where id = annotations.item_id), auth.uid(), 'admin')
  );

drop policy if exists annotation_comments_update on public.annotation_comments;
create policy annotation_comments_update on public.annotation_comments
  for update to authenticated
  using (
    author_id = auth.uid()
    or public.has_library_role(
      (select library_id from public.items where id = (select item_id from public.annotations where id = annotation_comments.annotation_id)),
      auth.uid(),
      'admin'
    )
  )
  with check (
    author_id = auth.uid()
    or public.has_library_role(
      (select library_id from public.items where id = (select item_id from public.annotations where id = annotation_comments.annotation_id)),
      auth.uid(),
      'admin'
    )
  );

-- Operations and activities are append-only from clients. Trusted Worker
-- service-role operations bypass RLS for processing and audit writes.
drop policy if exists annotation_operations_update on public.annotation_operations;
drop policy if exists annotation_operations_delete on public.annotation_operations;
create policy annotation_operations_update on public.annotation_operations
  for update to authenticated using (false) with check (false);
create policy annotation_operations_delete on public.annotation_operations
  for delete to authenticated using (false);

drop policy if exists activities_insert on public.activities;
drop policy if exists activities_update on public.activities;
drop policy if exists activities_delete on public.activities;
create policy activities_insert on public.activities
  for insert to authenticated with check (false);
create policy activities_update on public.activities
  for update to authenticated using (false) with check (false);
create policy activities_delete on public.activities
  for delete to authenticated using (false);

drop policy if exists sync_operations_update on public.sync_operations;
drop policy if exists sync_operations_delete on public.sync_operations;
create policy sync_operations_update on public.sync_operations
  for update to authenticated using (false) with check (false);
create policy sync_operations_delete on public.sync_operations
  for delete to authenticated using (false);

drop policy if exists search_documents_insert on public.search_documents;
drop policy if exists search_documents_update on public.search_documents;
drop policy if exists search_documents_delete on public.search_documents;
create policy search_documents_insert on public.search_documents
  for insert to authenticated with check (false);
create policy search_documents_update on public.search_documents
  for update to authenticated using (false) with check (false);
create policy search_documents_delete on public.search_documents
  for delete to authenticated using (false);

-- Reply threads were part of the domain contract before the original table
-- shipped. Add the nullable relation so old root comments remain valid while
-- replies can be validated and rendered consistently across clients.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'annotation_comments' and column_name = 'parent_id'
  ) then
    alter table public.annotation_comments
      add column parent_id uuid references public.annotation_comments (id) on delete cascade;
    create index if not exists annotation_comments_parent_idx
      on public.annotation_comments (annotation_id, parent_id, created_at);
  end if;
end;
$$;
