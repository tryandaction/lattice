-- Revoking a GitHub identity removes only memberships whose provenance is a
-- GitHub repository grant. Explicit/manual memberships and library content stay.
create or replace function public.cloud_github_unbind_identity(p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,51));

  delete from public.cloud_github_oauth_states where user_id=p_user_id;

  delete from public.library_members m using public.cloud_github_member_grants g
  where g.user_id=p_user_id and m.library_id=(select c.library_id from public.cloud_github_connections c where c.id=g.connection_id)
    and m.user_id=p_user_id and m.role='editor' and m.status='active';
  delete from public.cloud_github_member_grants where user_id=p_user_id;

  -- Connections created under the revoked identity cannot use its credentials
  -- for future webhook/member synchronization. Their cleanup trigger preserves
  -- any membership whose GitHub provenance has already been removed manually.
  delete from public.cloud_github_connections where connected_by=p_user_id;
  delete from public.cloud_github_identities where user_id=p_user_id;
end $$;

revoke all on function public.cloud_github_unbind_identity(uuid) from public,anon,authenticated;
grant execute on function public.cloud_github_unbind_identity(uuid) to service_role;
