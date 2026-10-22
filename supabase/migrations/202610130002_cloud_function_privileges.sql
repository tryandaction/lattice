-- Internal trigger functions are not RPCs. Retain authenticated policy helpers
-- and intended RPCs; anonymous callers do not need SECURITY DEFINER execution.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature,
      p.prorettype='trigger'::regtype as is_trigger
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.prosecdef or p.prorettype='trigger'::regtype)
  loop
    execute format('revoke execute on function %s from public, anon',f.signature);
    if f.is_trigger then
      execute format('revoke execute on function %s from authenticated',f.signature);
    else
      execute format('grant execute on function %s to authenticated',f.signature);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
