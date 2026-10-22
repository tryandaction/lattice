/** Shared normalized compatibility catalog. Table contents and sequence observations are separate. */
export const platformCatalogSql = `SELECT coalesce(json_agg(row_to_json(r) ORDER BY r.schema,r.name),'[]'::json) FROM (
  SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind,c.relrowsecurity AS row_security,
    c.relforcerowsecurity AS force_row_security,
    pg_get_userbyid(c.relowner) AS owner,
    (SELECT coalesce(json_agg(a::text ORDER BY a::text),'[]'::json) FROM unnest(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a) AS permissions,
    coalesce((SELECT json_agg(json_build_object('name',p.policyname,'permissive',p.permissive,'roles',p.roles,'command',p.cmd,'using',p.qual,'check',p.with_check) ORDER BY p.policyname)
      FROM pg_policies p WHERE p.schemaname=n.nspname AND p.tablename=c.relname),'[]'::json) AS policies,
    coalesce((SELECT json_agg(json_build_object('name',con.conname,'type',con.contype,'definition',pg_get_constraintdef(con.oid,true),'validated',con.convalidated) ORDER BY con.conname)
      FROM pg_constraint con WHERE con.conrelid=c.oid),'[]'::json) AS constraints,
    coalesce((SELECT json_agg(json_build_object('name',tr.tgname,'enabled',tr.tgenabled,'definition',pg_get_triggerdef(tr.oid,true)) ORDER BY tr.tgname)
      FROM pg_trigger tr WHERE tr.tgrelid=c.oid AND NOT tr.tgisinternal),'[]'::json) AS triggers,
    coalesce((SELECT json_agg(json_build_object('name',ic.relname,'definition',pg_get_indexdef(i.indexrelid),'unique',i.indisunique,'primary',i.indisprimary,
      'exclusion',i.indisexclusion,'immediate',i.indimmediate,'nulls_not_distinct',i.indnullsnotdistinct,'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,
      'predicate',pg_get_expr(i.indpred,i.indrelid)) ORDER BY ic.relname) FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=c.oid),'[]'::json) AS indexes,
    (SELECT json_build_object('start',s.seqstart::text,'increment',s.seqincrement::text,'minimum',s.seqmin::text,'maximum',s.seqmax::text,'cache',s.seqcache::text,'cycle',s.seqcycle) FROM pg_sequence s WHERE s.seqrelid=c.oid) AS sequence_definition,
    coalesce((SELECT json_agg(json_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),
      'permissions',(SELECT coalesce(json_agg(acl::text ORDER BY acl::text),'[]'::json) FROM unnest(a.attacl) acl)) ORDER BY a.attnum)
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'::json) AS columns
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','p','S') AND NOT (n.nspname='auth' AND c.relname='schema_migrations')
    AND NOT EXISTS(SELECT 1 FROM pg_depend dep WHERE dep.classid='pg_class'::regclass AND dep.objid=c.oid AND dep.deptype='e')
) r`;

// Bind helpers as well as policy/trigger call sites. OIDs differ across projects;
// names, definitions, security settings and grants must not silently differ.
export const platformRoutineCatalogSql = `SELECT coalesce(json_agg(row_to_json(r) ORDER BY r.schema,r.name,r.arguments),'[]'::json) FROM (
  SELECT n.nspname AS schema,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,
    p.prokind AS kind,pg_get_functiondef(p.oid) AS definition,pg_get_userbyid(p.proowner) AS owner,
    p.prosecdef AS security_definer,p.proleakproof AS leakproof,p.provolatile AS volatility,p.proparallel AS parallel,
    (SELECT coalesce(json_agg(a::text ORDER BY a::text),'[]'::json) FROM unnest(coalesce(p.proacl,acldefault('f',p.proowner))) a) AS permissions
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','auth') AND p.prokind IN ('f','p','w')
    AND NOT EXISTS(SELECT 1 FROM pg_depend dep WHERE dep.classid='pg_proc'::regclass AND dep.objid=p.oid AND dep.deptype='e')
) r`;

export const platformIdentifier = value => typeof value === 'string' && /^[a-z_][a-z0-9_]{0,62}$/.test(value);
export const quotedPlatformIdentifier = value => { if (!platformIdentifier(value)) throw new Error('POSTGRES_PLATFORM_IDENTIFIER_INVALID'); return '"' + value + '"'; };
export const platformRelationName = row => quotedPlatformIdentifier(row.schema) + '.' + quotedPlatformIdentifier(row.name);
