-- ============================================================================
-- 202608200002_shared_library_rls.sql
--
-- Row Level Security for the shared library.
--
-- Hard rule: every policy derives the effective role from the database
-- (`library_members` / `organization_members`) and from `auth.uid()`. A role
-- or permission supplied by the client is never trusted; the frontend hiding
-- a button is not authorization.
--
-- The `security definer` helper functions below are owned by `postgres`, run
-- with `search_path = public`, and bypass RLS on the membership tables so the
-- policies can evaluate membership without recursion.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Membership helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(target_organization_id uuid, target_user_id uuid)
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
  );
$$;

create or replace function public.is_library_member(target_library_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.library_members lm
    where lm.library_id = target_library_id
      and lm.user_id = target_user_id
      and lm.status = 'active'
  );
$$;

-- required_role thresholds: viewer < commenter < editor < admin < owner
create or replace function public.has_library_role(target_library_id uuid, target_user_id uuid, required_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.library_members lm
    where lm.library_id = target_library_id
      and lm.user_id = target_user_id
      and lm.status = 'active'
      and case required_role
        when 'viewer' then lm.role in ('viewer', 'commenter', 'editor', 'admin', 'owner')
        when 'commenter' then lm.role in ('commenter', 'editor', 'admin', 'owner')
        when 'editor' then lm.role in ('editor', 'admin', 'owner')
        when 'admin' then lm.role in ('admin', 'owner')
        when 'owner' then lm.role = 'owner'
        else false
      end
  );
$$;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;

create policy "organizations_select" on public.organizations
  for select to authenticated
  using (public.is_org_member(id, auth.uid()) or created_by = auth.uid());

create policy "organizations_insert" on public.organizations
  for insert to authenticated
  with check (created_by = auth.uid());

create policy "organizations_update" on public.organizations
  for update to authenticated
  using (
    exists (
      select 1 from public.organization_members om
      where om.organization_id = id and om.user_id = auth.uid() and om.role in ('owner', 'admin')
    )
  );

create policy "organizations_delete" on public.organizations
  for delete to authenticated
  using (
    exists (
      select 1 from public.organization_members om
      where om.organization_id = id and om.user_id = auth.uid() and om.role = 'owner'
    )
  );

-- ---------------------------------------------------------------------------
-- organization_members
-- ---------------------------------------------------------------------------

alter table public.organization_members enable row level security;

create policy "organization_members_select" on public.organization_members
  for select to authenticated
  using (public.is_org_member(organization_id, auth.uid()));

create policy "organization_members_insert" on public.organization_members
  for insert to authenticated
  with check (user_id = auth.uid() and role = 'owner');

create policy "organization_members_update" on public.organization_members
  for update to authenticated
  using (public.is_org_member(organization_id, auth.uid()));

create policy "organization_members_delete" on public.organization_members
  for delete to authenticated
  using (public.is_org_member(organization_id, auth.uid()));

-- ---------------------------------------------------------------------------
-- libraries
-- ---------------------------------------------------------------------------

alter table public.libraries enable row level security;

create policy "libraries_select" on public.libraries
  for select to authenticated
  using (public.is_library_member(id, auth.uid()) or created_by = auth.uid());

create policy "libraries_insert" on public.libraries
  for insert to authenticated
  with check (created_by = auth.uid());

create policy "libraries_update" on public.libraries
  for update to authenticated
  using (public.has_library_role(id, auth.uid(), 'admin'));

create policy "libraries_delete" on public.libraries
  for delete to authenticated
  using (public.has_library_role(id, auth.uid(), 'owner'));

-- ---------------------------------------------------------------------------
-- library_members
-- ---------------------------------------------------------------------------

alter table public.library_members enable row level security;

create policy "library_members_select" on public.library_members
  for select to authenticated
  using (public.is_library_member(library_id, auth.uid()));

create policy "library_members_insert" on public.library_members
  for insert to authenticated
  with check (
    (user_id = auth.uid() and role = 'owner')
    or public.has_library_role(library_id, auth.uid(), 'admin')
  );

create policy "library_members_update" on public.library_members
  for update to authenticated
  using (public.has_library_role(library_id, auth.uid(), 'admin'));

create policy "library_members_delete" on public.library_members
  for delete to authenticated
  using (public.has_library_role(library_id, auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- collections
-- ---------------------------------------------------------------------------

alter table public.collections enable row level security;

create policy "collections_select" on public.collections
  for select to authenticated
  using (public.is_library_member(library_id, auth.uid()));

create policy "collections_insert" on public.collections
  for insert to authenticated
  with check (public.has_library_role(library_id, auth.uid(), 'admin'));

create policy "collections_update" on public.collections
  for update to authenticated
  using (public.has_library_role(library_id, auth.uid(), 'admin'));

create policy "collections_delete" on public.collections
  for delete to authenticated
  using (public.has_library_role(library_id, auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- items
-- ---------------------------------------------------------------------------

alter table public.items enable row level security;

create policy "items_select" on public.items
  for select to authenticated
  using (public.is_library_member(library_id, auth.uid()));

create policy "items_insert" on public.items
  for insert to authenticated
  with check (public.has_library_role(library_id, auth.uid(), 'editor'));

create policy "items_update" on public.items
  for update to authenticated
  using (public.has_library_role(library_id, auth.uid(), 'editor'));

create policy "items_delete" on public.items
  for delete to authenticated
  using (public.has_library_role(library_id, auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- item_children
-- ---------------------------------------------------------------------------

alter table public.item_children enable row level security;

create policy "item_children_select" on public.item_children
  for select to authenticated
  using (
    public.is_library_member(
      (select library_id from public.items where id = item_children.parent_item_id),
      auth.uid()
    )
  );

create policy "item_children_insert" on public.item_children
  for insert to authenticated
  with check (
    public.has_library_role(
      (select library_id from public.items where id = item_children.parent_item_id),
      auth.uid(),
      'editor'
    )
  );

create policy "item_children_update" on public.item_children
  for update to authenticated
  using (
    public.has_library_role(
      (select library_id from public.items where id = item_children.parent_item_id),
      auth.uid(),
      'editor'
    )
  );

create policy "item_children_delete" on public.item_children
  for delete to authenticated
  using (
    public.has_library_role(
      (select library_id from public.items where id = item_children.parent_item_id),
      auth.uid(),
      'editor'
    )
  );

-- ---------------------------------------------------------------------------
-- blobs
-- ---------------------------------------------------------------------------

alter table public.blobs enable row level security;

create policy "blobs_select" on public.blobs
  for select to authenticated
  using (public.is_library_member(library_id, auth.uid()));

create policy "blobs_insert" on public.blobs
  for insert to authenticated
  with check (public.has_library_role(library_id, auth.uid(), 'editor'));

create policy "blobs_update" on public.blobs
  for update to authenticated
  using (public.has_library_role(library_id, auth.uid(), 'editor'));

create policy "blobs_delete" on public.blobs
  for delete to authenticated
  using (public.has_library_role(library_id, auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- item_versions
-- ---------------------------------------------------------------------------

alter table public.item_versions enable row level security;

create policy "item_versions_select" on public.item_versions
  for select to authenticated
  using (
    public.is_library_member(
      (select library_id from public.items where id = item_versions.item_id),
      auth.uid()
    )
  );

create policy "item_versions_insert" on public.item_versions
  for insert to authenticated
  with check (
    public.has_library_role(
      (select library_id from public.items where id = item_versions.item_id),
      auth.uid(),
      'editor'
    )
  );

create policy "item_versions_update" on public.item_versions
  for update to authenticated
  using (
    public.has_library_role(
      (select library_id from public.items where id = item_versions.item_id),
      auth.uid(),
      'editor'
    )
  );

create policy "item_versions_delete" on public.item_versions
  for delete to authenticated
  using (
    public.has_library_role(
      (select library_id from public.items where id = item_versions.item_id),
      auth.uid(),
      'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- annotations
-- ---------------------------------------------------------------------------

alter table public.annotations enable row level security;

create policy "annotations_select" on public.annotations
  for select to authenticated
  using (
    public.is_library_member(
      (select library_id from public.items where id = annotations.item_id),
      auth.uid()
    )
  );

create policy "annotations_insert" on public.annotations
  for insert to authenticated
  with check (
    public.has_library_role(
      (select library_id from public.items where id = annotations.item_id),
      auth.uid(),
      'commenter'
    )
  );

create policy "annotations_update" on public.annotations
  for update to authenticated
  using (
    public.has_library_role(
      (select library_id from public.items where id = annotations.item_id),
      auth.uid(),
      'commenter'
    )
  );

create policy "annotations_delete" on public.annotations
  for delete to authenticated
  using (
    public.has_library_role(
      (select library_id from public.items where id = annotations.item_id),
      auth.uid(),
      'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- annotation_comments
-- ---------------------------------------------------------------------------

alter table public.annotation_comments enable row level security;

create policy "annotation_comments_select" on public.annotation_comments
  for select to authenticated
  using (
    public.is_library_member(
      (select item_id from public.annotations where id = annotation_comments.annotation_id),
      auth.uid()
    )
  );

create policy "annotation_comments_insert" on public.annotation_comments
  for insert to authenticated
  with check (
    public.has_library_role(
      (select library_id from public.items where id = (select item_id from public.annotations where id = annotation_comments.annotation_id)),
      auth.uid(),
      'commenter'
    )
  );

create policy "annotation_comments_update" on public.annotation_comments
  for update to authenticated
  using (
    public.has_library_role(
      (select library_id from public.items where id = (select item_id from public.annotations where id = annotation_comments.annotation_id)),
      auth.uid(),
      'commenter'
    )
  );

create policy "annotation_comments_delete" on public.annotation_comments
  for delete to authenticated
  using (
    public.has_library_role(
      (select library_id from public.items where id = (select item_id from public.annotations where id = annotation_comments.annotation_id)),
      auth.uid(),
      'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- annotation_operations
-- ---------------------------------------------------------------------------

alter table public.annotation_operations enable row level security;

create policy "annotation_operations_select" on public.annotation_operations
  for select to authenticated
  using (
    public.is_library_member(
      (select library_id from public.items where id = (select item_id from public.annotations where id = annotation_operations.annotation_id)),
      auth.uid()
    )
  );

create policy "annotation_operations_insert" on public.annotation_operations
  for insert to authenticated
  with check (
    public.has_library_role(
      (select library_id from public.items where id = (select item_id from public.annotations where id = annotation_operations.annotation_id)),
      auth.uid(),
      'commenter'
    )
  );

create policy "annotation_operations_update" on public.annotation_operations
  for update to authenticated
  using (
    public.has_library_role(
      (select library_id from public.items where id = (select item_id from public.annotations where id = annotation_operations.annotation_id)),
      auth.uid(),
      'commenter'
    )
  );

create policy "annotation_operations_delete" on public.annotation_operations
  for delete to authenticated
  using (
    public.has_library_role(
      (select library_id from public.items where id = (select item_id from public.annotations where id = annotation_operations.annotation_id)),
      auth.uid(),
      'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- sync_operations
-- ---------------------------------------------------------------------------

alter table public.sync_operations enable row level security;

create policy "sync_operations_select" on public.sync_operations
  for select to authenticated
  using (public.is_library_member(library_id, auth.uid()));

create policy "sync_operations_insert" on public.sync_operations
  for insert to authenticated
  with check (public.has_library_role(library_id, auth.uid(), 'editor'));

create policy "sync_operations_update" on public.sync_operations
  for update to authenticated
  using (public.has_library_role(library_id, auth.uid(), 'editor'));

create policy "sync_operations_delete" on public.sync_operations
  for delete to authenticated
  using (public.has_library_role(library_id, auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- sync_cursors
-- ---------------------------------------------------------------------------

alter table public.sync_cursors enable row level security;

create policy "sync_cursors_select" on public.sync_cursors
  for select to authenticated
  using (public.is_library_member(library_id, auth.uid()));

create policy "sync_cursors_insert" on public.sync_cursors
  for insert to authenticated
  with check (public.has_library_role(library_id, auth.uid(), 'editor'));

create policy "sync_cursors_update" on public.sync_cursors
  for update to authenticated
  using (public.has_library_role(library_id, auth.uid(), 'editor'));

create policy "sync_cursors_delete" on public.sync_cursors
  for delete to authenticated
  using (public.has_library_role(library_id, auth.uid(), 'editor'));

-- ---------------------------------------------------------------------------
-- activities
-- ---------------------------------------------------------------------------

alter table public.activities enable row level security;

create policy "activities_select" on public.activities
  for select to authenticated
  using (public.is_library_member(library_id, auth.uid()));

create policy "activities_insert" on public.activities
  for insert to authenticated
  with check (public.has_library_role(library_id, auth.uid(), 'editor'));

create policy "activities_update" on public.activities
  for update to authenticated
  using (public.has_library_role(library_id, auth.uid(), 'admin'));

create policy "activities_delete" on public.activities
  for delete to authenticated
  using (public.has_library_role(library_id, auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- invitations
-- ---------------------------------------------------------------------------

alter table public.invitations enable row level security;

create policy "invitations_select" on public.invitations
  for select to authenticated
  using (public.is_library_member(library_id, auth.uid()));

create policy "invitations_insert" on public.invitations
  for insert to authenticated
  with check (public.has_library_role(library_id, auth.uid(), 'admin'));

create policy "invitations_update" on public.invitations
  for update to authenticated
  using (public.has_library_role(library_id, auth.uid(), 'admin'));

create policy "invitations_delete" on public.invitations
  for delete to authenticated
  using (public.has_library_role(library_id, auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- trash_entries
-- ---------------------------------------------------------------------------

alter table public.trash_entries enable row level security;

create policy "trash_entries_select" on public.trash_entries
  for select to authenticated
  using (public.is_library_member(library_id, auth.uid()));

create policy "trash_entries_insert" on public.trash_entries
  for insert to authenticated
  with check (public.has_library_role(library_id, auth.uid(), 'editor'));

create policy "trash_entries_update" on public.trash_entries
  for update to authenticated
  using (public.has_library_role(library_id, auth.uid(), 'admin'));

create policy "trash_entries_delete" on public.trash_entries
  for delete to authenticated
  using (public.has_library_role(library_id, auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- search_documents
-- ---------------------------------------------------------------------------

alter table public.search_documents enable row level security;

create policy "search_documents_select" on public.search_documents
  for select to authenticated
  using (public.is_library_member(library_id, auth.uid()));

create policy "search_documents_insert" on public.search_documents
  for insert to authenticated
  with check (public.has_library_role(library_id, auth.uid(), 'editor'));

create policy "search_documents_update" on public.search_documents
  for update to authenticated
  using (public.has_library_role(library_id, auth.uid(), 'editor'));

create policy "search_documents_delete" on public.search_documents
  for delete to authenticated
  using (public.has_library_role(library_id, auth.uid(), 'admin'));
