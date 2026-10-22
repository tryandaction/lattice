-- ============================================================================
-- supabase/seed/shared-library.sql
--
-- Demo seed used by `supabase db reset`. Idempotent: it only inserts a demo
-- organization/library when they are absent and an auth user exists.
-- ============================================================================

do $$
begin
  if exists (select 1 from auth.users limit 1) then
    insert into public.organizations (name, slug, created_by)
    select 'Demo Organization', 'demo-org', (select id from auth.users order by created_at limit 1)
    on conflict (slug) do nothing;

    insert into public.libraries (organization_id, name, slug, created_by)
    select o.id, 'Shared Research Library', 'shared-research', o.created_by
    from public.organizations o
    where o.slug = 'demo-org'
    on conflict do nothing;
  end if;
end $$;
