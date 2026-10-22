/** Restore trusted operator data into a distinct, initialized, otherwise unused Lattice platform. */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { openPostgresSession, postgresConnectionEnvironment, runPostgresTool } from './cloud-library-postgres-process.mjs';
import { platformCatalogSql, platformRoutineCatalogSql, platformIdentifier, platformRelationName } from './cloud-library-platform-catalog.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const required = { 'platform-data': 'platform-data.dump', catalog: 'catalog.json', 'migration-ledger': 'migration-ledger.json', 'storage-config': 'storage-config.json', inventory: 'inventory.json' };
const sqlJson = value => `convert_from(decode('${Buffer.from(JSON.stringify(value)).toString('hex')}','hex'),'UTF8')::jsonb`;
async function regular(path, directory = false) {
  const parent=dirname(path); if(parent!==path) await regular(parent,true);
  const stats=await lstat(path);
  if(stats.isSymbolicLink() || !(directory?stats.isDirectory():stats.isFile())) throw new Error('PLATFORM_CAPTURE_PATH_UNSAFE');
  return stats;
}
async function jsonFile(path) {
  if((await regular(path)).size>16*1024*1024) throw new Error('PLATFORM_CAPTURE_METADATA_LIMIT');
  const bytes=await readFile(path); if(bytes.length>16*1024*1024) throw new Error('PLATFORM_CAPTURE_METADATA_LIMIT');
  return JSON.parse(bytes.toString('utf8'));
}
function structuralCatalog(relations) {
  return relations.map(({schema,name,kind,row_security,force_row_security,owner,permissions,policies,constraints,triggers,indexes,columns,sequence_definition})=>({schema,name,kind,row_security,force_row_security,owner,permissions,policies,constraints,triggers,indexes,columns,sequence_definition}));
}
async function stageCapture(root, staging) {
  await regular(root,true);
  const capture=await jsonFile(resolve(root,'platform-capture.json'));
  if(capture.version!==1 || capture.complete!==true || capture.scope!=='lattice-platform-data-snapshot' || !validId(capture.projectRef) || !validId(capture.snapshotId)
    || !/^[a-f0-9]{64}$/.test(capture.databaseIdentitySha256) || capture.databaseSnapshotVerified!==true || capture.storageObjectMetadataIncluded!==false
    || capture.sequenceConsistency!=='unverified-nontransactional' || !Array.isArray(capture.artifacts) || capture.artifacts.length!==5) throw new Error('PLATFORM_CAPTURE_INVALID');
  const kinds=new Set();
  for(const item of capture.artifacts) {
    if(!Object.hasOwn(required,item.kind) || kinds.has(item.kind) || item.path!==required[item.kind] || item.snapshotId!==capture.snapshotId || !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes<0 || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('PLATFORM_CAPTURE_ARTIFACT_INVALID');
    kinds.add(item.kind);const source=resolve(root,item.path);
    if((await regular(source)).size!==item.sizeBytes) throw new Error('PLATFORM_CAPTURE_INTEGRITY_MISMATCH');
    if(item.kind!=='platform-data' && item.sizeBytes>16*1024*1024) throw new Error('PLATFORM_CAPTURE_METADATA_LIMIT');
    const digest=createHash('sha256');let size=0;
    const meter=new Transform({transform(bytes,_encoding,callback){size+=bytes.length;if(size>item.sizeBytes){callback(new Error('PLATFORM_CAPTURE_INTEGRITY_MISMATCH'));return;}digest.update(bytes);callback(null,bytes);}});
    await pipeline(createReadStream(source),meter,createWriteStream(resolve(staging,item.path),{flags:'wx',mode:0o600}));
    if(size!==item.sizeBytes || digest.digest('hex')!==item.sha256) throw new Error('PLATFORM_CAPTURE_INTEGRITY_MISMATCH');
  }
  const catalog=await jsonFile(resolve(staging,'catalog.json')), ledger=await jsonFile(resolve(staging,'migration-ledger.json'));
  const storage=await jsonFile(resolve(staging,'storage-config.json')), inventory=await jsonFile(resolve(staging,'inventory.json'));
  if(catalog.version!==1 || catalog.snapshotId!==capture.snapshotId || catalog.sequenceConsistency!=='unverified-nontransactional' || !Array.isArray(catalog.relations) || !catalog.relations.length || catalog.relations.length>1000
    || !Array.isArray(catalog.routines) || catalog.routines.length>1000 || !Array.isArray(ledger) || !Array.isArray(storage.buckets) || storage.buckets.length!==1 || storage.objectRowsExcluded!==true
    || inventory.scope!=='full-project' || inventory.version!==1 || inventory.projectRef!==capture.projectRef || inventory.snapshotId!==capture.snapshotId || !Array.isArray(inventory.libraryIds) || !Array.isArray(inventory.objects)) throw new Error('PLATFORM_CAPTURE_BINDING_INVALID');
  const names=new Set();
  for(const row of catalog.relations) {
    if(!['public','auth'].includes(row.schema) || !platformIdentifier(row.name) || row.schema==='auth' && row.name==='schema_migrations'
      || !['r','p','S'].includes(row.kind) || typeof row.row_security!=='boolean' || !Array.isArray(row.columns) || row.columns.length>1000
      || row.kind!=='S' && (!Number.isSafeInteger(row.rows) || row.rows<0) || names.has(platformRelationName(row))) throw new Error('PLATFORM_CAPTURE_CATALOG_INVALID');
    names.add(platformRelationName(row));
    if(row.kind==='S' && (!row.sequence || !/^-?\d{1,19}$/.test(row.sequence.last_value) || typeof row.sequence.is_called!=='boolean' || !row.sequence_definition)) throw new Error('PLATFORM_CAPTURE_SEQUENCE_INVALID');
  }
  if(!names.has('"auth"."users"') || !names.has('"public"."libraries"') || !names.has('"public"."blobs"')) throw new Error('PLATFORM_CAPTURE_CATALOG_INVALID');
  return {capture,catalog,ledger,storage,inventory};
}
async function extractTableData(staging,catalog,binDirectory,env) {
  const archive=resolve(staging,'platform-data.dump');
  const toc=await runPostgresTool({binDirectory,name:'pg_restore',env,args:['--list',archive]});
  const expected=new Map(catalog.relations.map(row=>[row.schema+'.'+row.name,row]));const copied=new Set(),selected=[];
  for(const line of toc.split(/\r?\n/)) {
    if(!line.trim() || line.startsWith(';')) continue;
    const entry=/^\d+; \d+ \d+ (TABLE DATA|SEQUENCE SET) (public|auth) ([a-z_][a-z0-9_]*) \S+$/.exec(line);
    const row=entry && expected.get(entry[2]+'.'+entry[3]);
    if(!entry || !row || entry[1]==='SEQUENCE SET' && row.kind!=='S' || entry[1]==='TABLE DATA' && row.kind==='S') throw new Error('PLATFORM_ARCHIVE_SCOPE_INVALID');
    if(entry[1]==='TABLE DATA') {const key=entry[2]+'.'+entry[3];if(copied.has(key)) throw new Error('PLATFORM_ARCHIVE_SCOPE_INVALID');copied.add(key);selected.push(line);}
  }
  if(catalog.relations.some(row=>row.kind==='r' && !copied.has(row.schema+'.'+row.name))) throw new Error('PLATFORM_ARCHIVE_TABLE_COVERAGE_MISMATCH');
  const list=resolve(staging,'table-data.list');await writeFile(list,selected.join('\n')+'\n',{flag:'wx',mode:0o600});
  const sql=resolve(staging,'table-data.sql');
  await runPostgresTool({binDirectory,name:'pg_restore',env,timeoutMs:600000,args:['--exit-on-error','--data-only','--no-owner','--no-privileges','--use-list='+list,'--file='+sql,archive]});
  return sql;
}
function guardedSql(point) {
  const {capture,catalog,ledger,storage}=point;
  const tables=catalog.relations.filter(row=>row.kind!=='S'), shape=structuralCatalog(catalog.relations);
  const lockNames=[...tables.map(platformRelationName),'storage.buckets','storage.objects','auth.schema_migrations','supabase_migrations.schema_migrations'];
  const initial=tables.map(row=>{
    const name=platformRelationName(row);
    if(row.schema==='public' && row.name==='cloud_storage_limits') return `IF (SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM ${name} t) <> '[{"singleton":true,"max_storage_bytes":950000000}]'::jsonb THEN RAISE EXCEPTION 'Initial configuration changed'; END IF;`;
    return `IF EXISTS(SELECT 1 FROM ${name}) THEN RAISE EXCEPTION 'Target business data must be empty'; END IF;`;
  }).join('\n');
  const bucket=storage.buckets[0];
  const bucketShape={id:bucket.id,name:bucket.name??null,public:bucket.public,file_size_limit:bucket.file_size_limit,allowed_mime_types:bucket.allowed_mime_types??null};
  const guard=`SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='120s'; SET LOCAL row_security=off;
    LOCK TABLE ${lockNames.join(',')} IN ACCESS EXCLUSIVE MODE;
    DO $guard$ DECLARE observed jsonb; BEGIN
      IF (SELECT encode(sha256(convert_to(system_identifier::text||':'||current_database(),'UTF8')),'hex') FROM pg_control_system())='${capture.databaseIdentitySha256}' THEN RAISE EXCEPTION 'Source identity refused'; END IF;
      SELECT (${platformCatalogSql})::jsonb INTO observed;
      IF observed <> ${sqlJson(shape)} THEN RAISE EXCEPTION 'Platform catalog incompatible'; END IF;
      SELECT (${platformRoutineCatalogSql})::jsonb INTO observed;
      IF observed <> ${sqlJson(catalog.routines)} THEN RAISE EXCEPTION 'Platform routines incompatible'; END IF;
      IF (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY version),'[]'::jsonb) FROM supabase_migrations.schema_migrations t) <> ${sqlJson(ledger)} THEN RAISE EXCEPTION 'Application migration versions incompatible'; END IF;
      IF EXISTS(SELECT 1 FROM storage.objects) OR (SELECT count(*) FROM storage.buckets)<>1 THEN RAISE EXCEPTION 'Target Storage is not unused'; END IF;
      SELECT jsonb_build_object('id',t.id,'name',to_jsonb(t)->'name','public',t.public,'file_size_limit',t.file_size_limit,'allowed_mime_types',to_jsonb(t)->'allowed_mime_types') INTO observed FROM storage.buckets t;
      IF observed <> ${sqlJson(bucketShape)} THEN RAISE EXCEPTION 'Storage configuration incompatible'; END IF;
      ${initial}
    END $guard$;
    SET LOCAL session_replication_role=replica;
    ${tables.some(row=>row.schema==='public'&&row.name==='cloud_storage_limits')?'DELETE FROM public.cloud_storage_limits WHERE singleton=true AND max_storage_bytes=950000000;':''}
  `;
  const restarts=catalog.relations.filter(row=>row.kind==='S').map(row=>{
    const def=row.sequence_definition;
    if(!['increment','minimum','maximum'].every(key=>typeof def[key]==='string'&&/^-?\d{1,19}$/.test(def[key])) || typeof def.cycle!=='boolean') throw new Error('PLATFORM_CAPTURE_SEQUENCE_INVALID');
    let next=BigInt(row.sequence.last_value)+(row.sequence.is_called?BigInt(def.increment):0n);
    if(next<BigInt(def.minimum)||next>BigInt(def.maximum)) {
      if(!def.cycle) throw new Error('PLATFORM_CAPTURE_SEQUENCE_EXHAUSTED');
      next=BigInt(def.increment)>0n?BigInt(def.minimum):BigInt(def.maximum);
    }
    return `ALTER SEQUENCE ${platformRelationName(row)} RESTART WITH ${next.toString()};`;
  }).join('\n');
  const counts=tables.map(row=>`IF (SELECT count(*) FROM ${platformRelationName(row)})<>${row.rows} THEN RAISE EXCEPTION 'Restored table count mismatch'; END IF;`).join('\n');
  const verify=`${restarts}
    SET LOCAL session_replication_role=origin;
    DO $verify$ DECLARE observed jsonb; fk record; equal_keys text; nonnull_keys text; any_null text; any_nonnull text; broken boolean; BEGIN
      ${counts}
      SELECT jsonb_build_object('libraryIds',coalesce((SELECT jsonb_agg(id::text ORDER BY id) FROM public.libraries),'[]'::jsonb),
        'objects',coalesce((SELECT jsonb_agg(jsonb_build_object('libraryId',library_id::text,'id',id::text,'storage_key',storage_key,'storage_backend',storage_backend,'size_bytes',size_bytes,'sha256',sha256,'mime_type',mime_type) ORDER BY library_id,id) FROM public.blobs),'[]'::jsonb)) INTO observed;
      IF observed <> (${sqlJson(point.inventory)} - ARRAY['version','scope','projectRef','snapshotId']) THEN RAISE EXCEPTION 'Restored inventory mismatch'; END IF;
      FOR fk IN SELECT c.* FROM pg_constraint c WHERE c.contype='f' AND c.conrelid IN (${tables.map(row=>`'${platformRelationName(row)}'::regclass`).join(',')}) LOOP
        SELECT string_agg(format('s.%I = r.%I',a.attname,b.attname),' AND ' ORDER BY k.pos),
          string_agg(format('s.%I IS NOT NULL',a.attname),' AND ' ORDER BY k.pos),
          string_agg(format('s.%I IS NULL',a.attname),' OR ' ORDER BY k.pos),
          string_agg(format('s.%I IS NOT NULL',a.attname),' OR ' ORDER BY k.pos)
          INTO equal_keys,nonnull_keys,any_null,any_nonnull
          FROM unnest(fk.conkey,fk.confkey) WITH ORDINALITY AS k(source_num,target_num,pos)
          JOIN pg_attribute a ON a.attrelid=fk.conrelid AND a.attnum=k.source_num
          JOIN pg_attribute b ON b.attrelid=fk.confrelid AND b.attnum=k.target_num;
        EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s s WHERE (%s) AND NOT EXISTS(SELECT 1 FROM %s r WHERE %s))',fk.conrelid::regclass,nonnull_keys,fk.confrelid::regclass,equal_keys) INTO broken;
        IF broken THEN RAISE EXCEPTION 'Restored foreign key mismatch'; END IF;
        IF fk.confmatchtype='f' THEN
          EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s s WHERE (%s) AND (%s))',fk.conrelid::regclass,any_null,any_nonnull) INTO broken;
          IF broken THEN RAISE EXCEPTION 'Restored full-match foreign key mismatch'; END IF;
        ELSIF fk.confmatchtype<>'s' THEN RAISE EXCEPTION 'Unsupported foreign key match mode'; END IF;
      END LOOP;
    END $verify$;`;
  return {guard,verify};
}

/** Only a distinct, operator-preinitialized target; no schema, role, migration ledger or Storage row replacement. */
export async function restorePostgresPlatformRecoverySnapshot({captureRoot,connection,binDirectory}) {
  const env=postgresConnectionEnvironment(connection), staging=await mkdtemp(resolve(tmpdir(),'lattice-platform-restore-'));let session;
  try {
    const point=await stageCapture(resolve(captureRoot),staging);
    if(point.capture.projectRef===connection.projectRef) throw new Error('PLATFORM_RESTORE_SOURCE_PROJECT_REFUSED');
    session=await openPostgresSession({binDirectory,env});
    const identity=JSON.parse(await session.query("SELECT json_build_object('system',system_identifier::text,'database',current_database()) FROM pg_control_system();"));
    if(hash(identity.system+':'+identity.database)===point.capture.databaseIdentitySha256) throw new Error('PLATFORM_RESTORE_SOURCE_IDENTITY_REFUSED');
    await session.close();session=null;
    const data=await extractTableData(staging,point.catalog,binDirectory,env),sql=guardedSql(point);
    await writeFile(resolve(staging,'guard.sql'),sql.guard,{flag:'wx',mode:0o600});
    await writeFile(resolve(staging,'verify.sql'),sql.verify,{flag:'wx',mode:0o600});
    await runPostgresTool({binDirectory,name:'psql',env,timeoutMs:600000,args:['-X','-w','-q','--single-transaction','-v','ON_ERROR_STOP=1','-f',resolve(staging,'guard.sql'),'-f',data,'-f',resolve(staging,'verify.sql')]});
    return {status:'restored-platform-data',inventoryVerifiedInTransaction:true,tableCountsVerified:true,foreignKeysVerified:true,sequenceRestartTransactional:true,schemaReplaced:false,rolesRestored:false,platformMigrationLedgerReplaced:false,storageMetadataRestored:false,physicalStorageRestored:false,hostedPlatformCompatibilityVerified:false,authenticationUsabilityVerified:false,productionRestoreVerified:false};
  } finally {await session?.close();await rm(staging,{recursive:true,force:true});}
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href) {
  try {
    const [captureRoot,projectRef,execute,...extra]=process.argv.slice(2);
    if(!captureRoot||!validId(projectRef)||extra.length||execute&&execute!=='--restore-platform-data') throw new Error('Invalid restore arguments');
    if(!execute) console.log(JSON.stringify({status:'prepared',filesRead:0,credentialsRead:false,databaseWrites:0,productionRestoreVerified:false}));
    else {
      const env=process.env;if(!env.LATTICE_RESTORE_PG_BIN) throw new Error('Explicit PostgreSQL tools required');
      const connection={host:env.LATTICE_RESTORE_PG_HOST,port:Number(env.LATTICE_RESTORE_PG_PORT),database:env.LATTICE_RESTORE_PG_DATABASE,user:env.LATTICE_RESTORE_PG_USER,password:env.LATTICE_RESTORE_PG_PASSWORD,sslMode:env.LATTICE_RESTORE_PG_SSLMODE,projectRef};
      console.log(JSON.stringify(await restorePostgresPlatformRecoverySnapshot({captureRoot,connection,binDirectory:env.LATTICE_RESTORE_PG_BIN})));
    }
  } catch {console.error(JSON.stringify({status:'failed',code:'PLATFORM_RESTORE_REFUSED_OR_FAILED'}));process.exitCode=1;}
}
