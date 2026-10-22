/** Real pinned Auth/PostgREST processes; all accounts, SMTP and databases are synthetic loopback fixtures. */
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash,createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { delimiter,resolve } from 'node:path';
import { nativePostgresFixture } from './native-postgres';
import { handleSupabaseEdgeRequest } from '../../shared-library-api/src/supabase-edge';

export const realAuthBin = process.env.LATTICE_TEST_AUTH_BIN;
export const realRestBin = process.env.LATTICE_TEST_POSTGREST_BIN;
// Explicit but incomplete/wrong tool configuration must fail, never silently skip acceptance.
export const realPlatformAuthAvailable = Boolean(process.platform==='win32'&&(realAuthBin||realRestBin));
const run = promisify(execFile);
const migrations = ['202608200001_shared_library_core.sql','202608200002_shared_library_rls.sql','202608300001_shared_library_security_hardening.sql','202610080001_cloud_team_library.sql','202610120001_cloud_member_display_names.sql','202610130001_cloud_supabase_storage.sql','202610130002_cloud_function_privileges.sql','202610170001_cloud_large_objects.sql'];

async function port() {
  const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const address=socket.address();if(!address||typeof address==='string')throw new Error('No fixture port');
  await new Promise<void>(resolve=>socket.close(()=>resolve()));return address.port;
}
async function smtpFixture() {
  const messages:string[]=[];
  const server=createServer(socket=>{
    socket.setEncoding('utf8');socket.write('220 synthetic.local ESMTP\r\n');
    let buffer='',data=false,body='';
    socket.on('data',(chunk:string)=>{
      buffer+=chunk;if(buffer.length+body.length>1024*1024){socket.destroy();return;}
      let end:number;
      while((end=buffer.indexOf('\r\n'))>=0){
        const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
        if(data){if(line==='.'){messages.push(body);body='';data=false;socket.write('250 Accepted\r\n');}else body+=line+'\r\n';continue;}
        if(/^EHLO|^HELO/i.test(line))socket.write('250-synthetic.local\r\n250 8BITMIME\r\n');
        else if(/^DATA$/i.test(line)){data=true;socket.write('354 End with dot\r\n');}
        else if(/^QUIT$/i.test(line)){socket.end('221 Bye\r\n');}
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();
  if(!address||typeof address==='string')throw new Error('No SMTP fixture');
  return {port:address.port,messages,close:()=>new Promise<void>(resolve=>server.close(()=>resolve()))};
}

export async function realPlatformAuthFixture() {
  if(!realAuthBin||!realRestBin)throw new Error('Explicit pinned acceptance executables required');
  for(const [path,expected] of [[realAuthBin,'eb2e14a755573ef98e202b9408ef21f7448d30d16b5cec6349b0c88713885925'],[realRestBin,'fbe713383e1b99e1be7b4aac2bc021304abd27101e9d7a440d4a6caab0b6c623']]){
    const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Acceptance executable must be a regular file');
    const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);
    if(hash.digest('hex')!==expected)throw new Error('Pinned acceptance executable hash mismatch');
  }
  const f=await nativePostgresFixture(),smtp=await smtpFixture();
  const processes=new Set<ChildProcess>();
  const systemEnv:NodeJS.ProcessEnv={...Object.fromEntries(['SystemRoot','WINDIR','PATH','TEMP','TMP'].filter(name=>process.env[name]!==undefined).map(name=>[name,process.env[name]])),NODE_ENV:'test'};
  const jwtSecret=randomBytes(48).toString('hex');
  const jwt=(role:string,sub?:string)=>{
    const head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
    const payload=Buffer.from(JSON.stringify({role,...(sub?{sub}:{}),iss:'synthetic-auth',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
    return head+'.'+payload+'.'+createHmac('sha256',jwtSecret).update(head+'.'+payload).digest('base64url');
  };
  const authConfig=(database:string,listenPort:number)=>({...systemEnv,
    GOTRUE_DB_DRIVER:'postgres',DATABASE_URL:`postgres://${f.connection.user}@127.0.0.1:${f.connection.port}/${database}?sslmode=disable&search_path=auth,public`,DB_NAMESPACE:'auth',
    GOTRUE_API_HOST:'127.0.0.1',PORT:String(listenPort),API_EXTERNAL_URL:`http://127.0.0.1:${listenPort}`,
    GOTRUE_SITE_URL:'http://127.0.0.1:39999',GOTRUE_URI_ALLOW_LIST:'http://127.0.0.1:39999',GOTRUE_JWT_SECRET:jwtSecret,GOTRUE_JWT_AUD:'authenticated',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',GOTRUE_JWT_ADMIN_ROLES:'service_role',
    GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_EXTERNAL_PHONE_ENABLED:'false',GOTRUE_DISABLE_SIGNUP:'false',GOTRUE_MAILER_AUTOCONFIRM:'false',
    GOTRUE_SMTP_HOST:'127.0.0.1',GOTRUE_SMTP_PORT:String(smtp.port),GOTRUE_SMTP_ADMIN_EMAIL:'noreply@synthetic.test',GOTRUE_SMTP_SENDER_NAME:'Lattice acceptance',GOTRUE_SMTP_MAX_FREQUENCY:'1ms',GOTRUE_SMTP_LOGGING_ENABLED:'false',
    GOTRUE_MAILER_URLPATHS_CONFIRMATION:'/verify',GOTRUE_MAILER_URLPATHS_RECOVERY:'/verify',
    GOTRUE_RATE_LIMIT_EMAIL_SENT:'1000',GOTRUE_DB_MAX_POOL_SIZE:'2',GOTRUE_DB_MAX_IDLE_POOL_SIZE:'1',LOG_LEVEL:'error',GOTRUE_TRACING_ENABLED:'false',GOTRUE_METRICS_ENABLED:'false',
  });
  async function stop(child:ChildProcess){if(child.exitCode!==null)return;const done=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill();await done;processes.delete(child);}
  async function start(executable:string,env:NodeJS.ProcessEnv,url:string){
    const child=spawn(executable,[],{env,cwd:f.root,windowsHide:true,stdio:['ignore','pipe','pipe']});processes.add(child);
    let diagnostics='';for(const output of [child.stdout,child.stderr]){output?.setEncoding('utf8');output?.on('data',chunk=>{diagnostics=(diagnostics+chunk).slice(-6000);});}
    child.on('error',()=>{});
    for(let attempt=0;attempt<200;attempt++){
      if(child.exitCode!==null){throw new Error('Synthetic platform process exited: '+diagnostics.replaceAll(jwtSecret,'[redacted]'));}
      try {if((await fetch(url,{signal:AbortSignal.timeout(500)})).ok)return {child,stop:()=>stop(child),diagnostics:()=>diagnostics.replaceAll(jwtSecret,'[redacted]')};}catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw new Error('Synthetic platform process readiness timed out: '+diagnostics.replaceAll(jwtSecret,'[redacted]'));
  }
  try {
    await f.sql('create role postgres nologin;create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create role authenticator login noinherit;grant anon,authenticated,service_role to authenticator;');
    for(const database of ['lattice_source','lattice_target']){
      await f.sql('create schema auth;',database);
      await run(realAuthBin,['migrate'],{cwd:f.root,env:authConfig(database,await port()),windowsHide:true,timeout:120000,maxBuffer:1024*1024});
      await f.sql(`
        create schema storage;create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint);
        create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;
        grant usage on schema public,auth,storage to authenticated,service_role;grant execute on all functions in schema auth to authenticated,service_role;
        create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key);`,database);
      for(const name of migrations){await f.file(resolve('supabase/migrations',name),database);await f.sql(`insert into supabase_migrations.schema_migrations values('${name.split('_')[0]}');`,database);}
      await f.sql('grant select,insert,update,delete on all tables in schema public,storage to authenticated,service_role;grant usage,select on all sequences in schema public to authenticated,service_role;',database);
    }
    return {...f,smtp,jwt,
      async startAuth(database:string){const listen=await port(),base=`http://127.0.0.1:${listen}`;return {...await start(realAuthBin,authConfig(database,listen),base+'/health'),base};},
      async startRest(database:string){const listen=await port(),base=`http://127.0.0.1:${listen}`;return {...await start(realRestBin,{...systemEnv,PATH:f.binDirectory+delimiter+(systemEnv.PATH??''),PGRST_DB_URI:`postgres://authenticator@127.0.0.1:${f.connection.port}/${database}?sslmode=disable`,PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_DB_POOL:'2',PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:String(listen),PGRST_JWT_SECRET:jwtSecret,PGRST_LOG_LEVEL:'crit'},base+'/'),base};},
      async gateway(authBase:string,restBase:string){
        let base='';const server=createHttpServer(async(request,response)=>{
          try{
            const url=new URL(request.url??'/',base),headers=new Headers();
            for(const [key,value] of Object.entries(request.headers))if(typeof value==='string'&&!['host','connection','content-length'].includes(key))headers.set(key,value);
            const chunks:Buffer[]=[];let length=0;for await(const chunk of request){length+=chunk.length;if(length>20971520)throw new Error('Synthetic request too large');chunks.push(Buffer.from(chunk));}
            const body=chunks.length?Buffer.concat(chunks):undefined;
            const init={method:request.method,headers,...(body?{body}:{}),redirect:'manual' as const};
            const result=url.pathname.startsWith('/auth/v1/')?await fetch(authBase+url.pathname.slice('/auth/v1'.length)+url.search,init)
              :url.pathname.startsWith('/rest/v1/')?await fetch(restBase+url.pathname.slice('/rest/v1'.length)+url.search,init)
              :await handleSupabaseEdgeRequest(new Request(url,init),{SUPABASE_URL:base,SUPABASE_ANON_KEY:jwt('anon'),BLOB_BACKEND:'supabase'});
            response.writeHead(result.status,Object.fromEntries(result.headers));response.end(Buffer.from(await result.arrayBuffer()));
          }catch{response.writeHead(500,{'content-type':'application/json'});response.end('{"error":"synthetic gateway failed"}');}
        });
        await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('No gateway');base=`http://127.0.0.1:${address.port}`;
        return {base,close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
      },
      async close(){await Promise.allSettled([...processes].map(stop));await smtp.close();await f.close();}
    };
  }catch(error){await Promise.allSettled([...processes].map(stop));await smtp.close();await f.close();throw error;}
}
