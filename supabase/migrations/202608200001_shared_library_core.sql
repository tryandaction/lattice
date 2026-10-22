-- ============================================================================
-- 202608200001_shared_library_core.sql
--
-- Core tables for the shared research library.
--
-- Identity rules enforced here:
--   * All ids are stable `uuid` generated server-side. File paths / file names
--     are never used as primary keys (items carry `canonical_name` only as a
--     display label).
--   * All timestamps are `timestamptz`; cross-device ordering never relies on
--     a client clock (sync uses `sync_cursors`, operations use
--     `idempotency_key` + server timestamps).
--   * PDF annotation geometry lives in `annotations.target`/`geometry` jsonb
--     and must stay page-local normalized (0-1); viewport/CSS pixels are
--     rejected by the application validators before this layer.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Organizations and members
-- ---------------------------------------------------------------------------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  status text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Libraries
-- ---------------------------------------------------------------------------

create table if not exists public.libraries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  visibility text not null default 'private' check (visibility in ('private', 'organization')),
  settings jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.library_members (
  library_id uuid not null references public.libraries (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'editor', 'commenter', 'viewer')),
  status text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (library_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Collections and items
-- ---------------------------------------------------------------------------

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries (id) on delete cascade,
  parent_collection_id uuid references public.collections (id) on delete cascade,
  name text not null,
  sort_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries (id) on delete cascade,
  collection_id uuid references public.collections (id) on delete set null,
  kind text not null check (
    kind in ('pdf', 'markdown', 'code', 'notebook', 'docx', 'pptx', 'image', 'web_snapshot', 'data', 'folder')
  ),
  title text not null,
  canonical_name text not null,
  source_url text,
  metadata jsonb not null default '{}'::jsonb,
  current_version_id uuid,
  content_hash text,
  status text not null default 'active' check (status in ('active', 'archived', 'trashed', 'conflicted')),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index items_library_updated_idx on public.items (library_id, updated_at);
create index items_collection_idx on public.items (collection_id);
create index items_status_idx on public.items (library_id, status);

create table if not exists public.item_children (
  parent_item_id uuid not null references public.items (id) on delete cascade,
  child_item_id uuid not null references public.items (id) on delete cascade,
  relative_path text not null,
  kind text not null,
  sort_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (parent_item_id, child_item_id),
  unique (parent_item_id, relative_path)
);

-- ---------------------------------------------------------------------------
-- Blobs and versions
-- ---------------------------------------------------------------------------

create table if not exists public.blobs (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries (id) on delete cascade,
  storage_key text not null unique,
  size_bytes bigint not null,
  sha256 text not null,
  mime_type text,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.item_versions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  version_number bigint not null,
  blob_id uuid references public.blobs (id) on delete set null,
  manifest jsonb not null default '{}'::jsonb,
  content_hash text not null,
  created_by uuid not null references auth.users (id) on delete cascade,
  base_version_id uuid references public.item_versions (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (item_id, version_number)
);

-- ---------------------------------------------------------------------------
-- Annotations and comments
-- ---------------------------------------------------------------------------

create table if not exists public.annotations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  version_id uuid not null references public.item_versions (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('highlight', 'underline', 'area', 'text', 'ink', 'comment')),
  target jsonb not null,
  quote jsonb,
  geometry jsonb,
  style jsonb not null default '{}'::jsonb,
  body jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'resolved', 'deleted', 'conflicted')),
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index annotations_item_updated_idx on public.annotations (item_id, updated_at);
create index annotations_item_version_idx on public.annotations (item_id, version_id);

create table if not exists public.annotation_comments (
  id uuid primary key default gen_random_uuid(),
  annotation_id uuid not null references public.annotations (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.annotation_operations (
  id uuid primary key default gen_random_uuid(),
  annotation_id uuid not null references public.annotations (id) on delete cascade,
  operation_type text not null,
  revision bigint not null,
  base_revision bigint,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  actor_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Sync
-- ---------------------------------------------------------------------------

create table if not exists public.sync_operations (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries (id) on delete cascade,
  actor_id uuid not null references auth.users (id) on delete cascade,
  device_id text not null,
  client_sequence bigint not null,
  operation_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  base_version bigint,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text
);

create table if not exists public.sync_cursors (
  library_id uuid not null references public.libraries (id) on delete cascade,
  device_id text not null,
  cursor text not null,
  updated_at timestamptz not null default now(),
  primary key (library_id, device_id)
);

-- ---------------------------------------------------------------------------
-- Activity, invitations, trash
-- ---------------------------------------------------------------------------

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index activities_library_created_idx on public.activities (library_id, created_at);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries (id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'editor', 'commenter', 'viewer')),
  invited_by uuid not null references auth.users (id) on delete cascade,
  token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create table if not exists public.trash_entries (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  trashed_by uuid not null references auth.users (id) on delete cascade,
  trashed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  restored_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Search
-- ---------------------------------------------------------------------------

create table if not exists public.search_documents (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  child_item_id uuid references public.items (id) on delete cascade,
  source_type text not null,
  title text not null default '',
  body text not null default '',
  snippet text,
  locator jsonb not null default '{}'::jsonb,
  permission_snapshot jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index search_documents_library_updated_idx
  on public.search_documents (library_id, updated_at);
create index search_documents_fts_idx
  on public.search_documents
  using gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, '')));
