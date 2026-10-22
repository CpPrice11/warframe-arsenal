import {validateCatalog,safeUrl} from './public/catalog-core.js';

const encoder=new TextEncoder();
const now=()=>Math.floor(Date.now()/1000);
const bytesToUrl=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export const randomToken=()=>bytesToUrl(crypto.getRandomValues(new Uint8Array(32)));
export async function digest(value){return bytesToUrl(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));}
export class HttpError extends Error{constructor(status,code){super(code);this.status=status;}}
function frontend(env){try{const u=new URL(env.FRONTEND_URL);if(u.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(u.hostname))throw Error();return u;}catch{throw new HttpError(503,'not_configured');}}
export async function readJson(request,max=512000){
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))throw new HttpError(415,'json_required');
  if(Number(request.headers.get('Content-Length'))>max)throw new HttpError(413,'body_too_large');
  const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'invalid_json');
  const chunks=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new HttpError(413,'body_too_large');}chunks.push(value);}
  const data=new Uint8Array(size);let offset=0;for(const part of chunks){data.set(part,offset);offset+=part.length;}
  try{return JSON.parse(new TextDecoder().decode(data));}catch{throw new HttpError(400,'invalid_json');}
}
async function limited(env,key,max,seconds=60){
  const window=Math.floor(now()/seconds);const result=await env.DB.prepare('INSERT INTO rate_limits(key,window_start,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start=excluded.window_start THEN count+1 ELSE 1 END,window_start=excluded.window_start RETURNING count').bind(key,window).first();
  if(result.count>max)throw new HttpError(429,'rate_limited');
}
function requireOrigin(request,env){if(request.headers.get('Origin')!==frontend(env).origin)throw new HttpError(403,'origin_denied');}
async function ownerSession(request,env){
  const authorization=request.headers.get('Authorization')||'';if(!/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)||!env.OWNER_GITHUB_ID)throw new HttpError(401,'sign_in_required');
  const hash=await digest(authorization.slice(7));const session=await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').bind(hash,now()).first();
  if(!session||session.user_id!==String(env.OWNER_GITHUB_ID))throw new HttpError(403,'owner_required');return {hash,userId:session.user_id};
}
async function boundedRemoteJson(response,max=64000){if(!response.ok)throw new HttpError(502,'identity_service_error');const reader=response.body.getReader();let text='';let size=0;const decoder=new TextDecoder();for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new HttpError(502,'identity_service_error');}text+=decoder.decode(value,{stream:true});}try{return JSON.parse(text+decoder.decode());}catch{throw new HttpError(502,'identity_service_error');}}
async function current(env){const value=await env.DB.prepare("SELECT document,version FROM catalog_store WHERE id='main'").first();if(!value)throw new HttpError(503,'catalog_not_imported');return {catalog:JSON.parse(value.document),version:value.version};}
const arsenalRecord=row=>({id:row.weapon_id,owned:Boolean(row.owned),wanted:Boolean(row.wanted),mastered:Boolean(row.mastered),revision:row.revision});
async function route(request,env){
  if(!env.DB)throw new HttpError(503,'not_configured');
  const u=new URL(request.url),path=u.pathname;
  if(['POST','PUT','DELETE'].includes(request.method))requireOrigin(request,env);
  if(path==='/api/catalog'&&request.method==='GET')return Response.json(await current(env),{headers:{'Cache-Control':'public, max-age=30'}});
  if(path==='/api/auth/start'&&request.method==='POST'){
    if(!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET||!env.OWNER_GITHUB_ID)throw new HttpError(503,'not_configured');
    await limited(env,'login:'+await digest(request.headers.get('CF-Connecting-IP')||'unknown'),5);
    const {challenge}=await readJson(request,1000);if(!/^[A-Za-z0-9_-]{43}$/.test(challenge))throw new HttpError(400,'invalid_challenge');
    const state=randomToken(),verifier=randomToken();await env.DB.prepare('INSERT INTO oauth_states(state_hash,oauth_verifier,client_challenge,expires_at) VALUES(?,?,?,?)').bind(await digest(state),verifier,challenge,now()+600).run();
    return Response.json({url:u.origin+'/auth/begin?state='+state});
  }
  if(path==='/auth/begin'&&request.method==='GET'){
    // A top-level visit sets the API-origin cookie without third-party cookies.
    const state=u.searchParams.get('state');if(!/^[A-Za-z0-9_-]{43}$/.test(state||''))throw new HttpError(400,'invalid_oauth_state');
    const saved=await env.DB.prepare('SELECT oauth_verifier FROM oauth_states WHERE state_hash=? AND expires_at>?').bind(await digest(state),now()).first();if(!saved)throw new HttpError(400,'expired_oauth_state');
    const authorize=new URL('https://github.com/login/oauth/authorize');authorize.search=new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,redirect_uri:u.origin+'/auth/callback',state,code_challenge:await digest(saved.oauth_verifier),code_challenge_method:'S256',scope:'',allow_signup:'false'}).toString();
    return new Response(null,{status:303,headers:{Location:authorize.href,'Set-Cookie':`__Host-wf-oauth=${state}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`}});
  }
  if(path==='/auth/callback'&&request.method==='GET'){
    const code=u.searchParams.get('code'),state=u.searchParams.get('state'),cookie=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-wf-oauth='))?.slice('__Host-wf-oauth='.length);
    if(!state||state!==cookie||!code||code.length>200||!/^[A-Za-z0-9_-]{43}$/.test(state))throw new HttpError(400,'invalid_oauth_state');
    const saved=await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash=? AND expires_at>? RETURNING oauth_verifier,client_challenge').bind(await digest(state),now()).first();if(!saved)throw new HttpError(400,'expired_oauth_state');
    const tokenData=await boundedRemoteJson(await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code,redirect_uri:u.origin+'/auth/callback',code_verifier:saved.oauth_verifier}),signal:AbortSignal.timeout(10000)}));
    if(typeof tokenData.access_token!=='string')throw new HttpError(401,'sign_in_failed');
    const identity=await boundedRemoteJson(await fetch('https://api.github.com/user',{headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+tokenData.access_token,'User-Agent':'Warframe-Arsenal','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(10000)}));
    // GitHub identity is verified on the server. No repository scopes are requested.
    if(String(identity.id)!==String(env.OWNER_GITHUB_ID))throw new HttpError(403,'owner_required');
    const exchange=randomToken();await env.DB.prepare('INSERT INTO auth_codes(code_hash,client_challenge,user_id,expires_at) VALUES(?,?,?,?)').bind(await digest(exchange),saved.client_challenge,String(identity.id),now()+60).run();
    const destination=frontend(env);destination.hash='login='+exchange;
    return new Response(null,{status:303,headers:{Location:destination.href,'Set-Cookie':'__Host-wf-oauth=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'}});
  }
  if(path==='/api/auth/exchange'&&request.method==='POST'){
    await limited(env,'exchange:'+await digest(request.headers.get('CF-Connecting-IP')||'unknown'),15);
    const {code,verifier}=await readJson(request,2000);if(!/^[A-Za-z0-9_-]{43}$/.test(code)||!/^[A-Za-z0-9_-]{43}$/.test(verifier))throw new HttpError(400,'invalid_auth_code');
    const saved=await env.DB.prepare('DELETE FROM auth_codes WHERE code_hash=? AND client_challenge=? AND expires_at>? RETURNING user_id').bind(await digest(code),await digest(verifier),now()).first();if(!saved||saved.user_id!==String(env.OWNER_GITHUB_ID))throw new HttpError(403,'owner_required');
    const token=randomToken();await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await digest(token),saved.user_id,now()+8*3600).run();return Response.json({token});
  }
  if(!path.startsWith('/api/admin/'))throw new HttpError(404,'not_found');
  const session=await ownerSession(request,env);
  if(path==='/api/admin/session'&&request.method==='GET')return Response.json({owner:true});
  if(path==='/api/admin/arsenal'&&request.method==='GET'){
    await limited(env,'arsenal-read:'+session.userId,120);
    const rows=await env.DB.prepare('SELECT weapon_id,owned,wanted,mastered,revision FROM personal_arsenal').all();
    return Response.json(rows.results.map(arsenalRecord));
  }
  if(path==='/api/admin/arsenal'&&request.method==='PUT'){
    await limited(env,'arsenal-write:'+session.userId,60);
    const expected=request.headers.get('If-Match');if(!/^(0|[1-9][0-9]{0,8})$/.test(expected||''))throw new HttpError(428,'version_required');
    const data=await readJson(request,1000);
    if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!['id','owned','wanted','mastered'].includes(k))||typeof data.id!=='string'||!/^[a-z0-9-]{1,100}$/.test(data.id)||!['owned','wanted','mastered'].every(k=>typeof data[k]==='boolean'))throw new HttpError(400,'invalid_arsenal');
    const {catalog}=await current(env);if(!catalog.weapons.some(r=>r.id===data.id&&!r.archived))throw new HttpError(404,'weapon_not_found');
    const row=Number(expected)===0
      ?await env.DB.prepare('INSERT INTO personal_arsenal(weapon_id,owned,wanted,mastered,revision) VALUES(?,?,?,?,1) ON CONFLICT(weapon_id) DO NOTHING RETURNING weapon_id,owned,wanted,mastered,revision').bind(data.id,+data.owned,+data.wanted,+data.mastered).first()
      :await env.DB.prepare('UPDATE personal_arsenal SET owned=?,wanted=?,mastered=?,revision=revision+1 WHERE weapon_id=? AND revision=? RETURNING weapon_id,owned,wanted,mastered,revision').bind(+data.owned,+data.wanted,+data.mastered,data.id,Number(expected)).first();
    if(!row)throw new HttpError(409,'version_conflict');return Response.json(arsenalRecord(row));
  }
  if(path==='/api/admin/logout'&&request.method==='POST'){await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(session.hash).run();return Response.json({ok:true});}
  if(path==='/api/admin/catalog'&&request.method==='PUT'){
    await limited(env,'write:'+session.userId,60);
    const expected=request.headers.get('If-Match');if(!/^[1-9][0-9]{0,8}$/.test(expected||''))throw new HttpError(428,'version_required');
    const data=await readJson(request);try{validateCatalog(data);}catch{throw new HttpError(400,'invalid_catalog');}
    const result=await env.DB.prepare("UPDATE catalog_store SET document=?,version=version+1,updated_at=? WHERE id='main' AND version=? RETURNING version").bind(JSON.stringify(data),new Date().toISOString(),Number(expected)).first();
    if(!result)throw new HttpError(409,'version_conflict');return Response.json(result);
  }
  if(path==='/api/admin/history'&&request.method==='GET'){const result=await env.DB.prepare('SELECT version,created_at FROM revisions ORDER BY version DESC LIMIT 100').all();return Response.json(result.results);}
  if(/^\/api\/admin\/history\/[1-9][0-9]{0,8}$/.test(path)&&request.method==='GET'){const result=await env.DB.prepare('SELECT document FROM revisions WHERE version=?').bind(Number(path.split('/').pop())).first();if(!result)throw new HttpError(404,'not_found');return Response.json(JSON.parse(result.document));}
  if(path==='/api/admin/check-build'&&request.method==='POST'){
    await limited(env,'checks:'+session.userId,60);
    const {id}=await readJson(request,1000);const {catalog}=await current(env);const record=catalog.weapons.find(w=>w.id===id&&!w.archived);
    if(!record?.build_url||!safeUrl(record.build_url,{build:true}))throw new HttpError(400,'invalid_build_url');
    const cached=await env.DB.prepare('SELECT url,status,checked_at FROM link_checks WHERE id=?').bind(id).first();
    if(cached&&cached.url===record.build_url&&Date.now()-Date.parse(cached.checked_at)<300000)return Response.json({status:cached.status,checkedAt:cached.checked_at,cached:true});
    let next=record.build_url,status=null;
    for(let n=0;n<4;n++){
      if(!safeUrl(next,{build:true}))break;
      try{
        let response=await fetch(next,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(10000)});
        if(response.status===405){await response.body?.cancel();response=await fetch(next,{method:'GET',headers:{Range:'bytes=0-0'},redirect:'manual',signal:AbortSignal.timeout(10000)});}
        const location=response.headers.get('Location');const code=response.status;await response.body?.cancel();
        if(code>=300&&code<400&&location){next=new URL(location,next).href;continue;}status=code;break;
      }catch{break;}
    }
    const checkedAt=new Date().toISOString();await env.DB.prepare('INSERT INTO link_checks(id,url,status,checked_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,status=excluded.status,checked_at=excluded.checked_at').bind(id,record.build_url,status,checkedAt).run();
    return Response.json({status,checkedAt,cached:false});
  }
  throw new HttpError(404,'not_found');
}
export async function handleRequest(request,env){
  let allowed='';try{allowed=frontend(env).origin;}catch{}
  const origin=request.headers.get('Origin');const cors=origin===allowed&&allowed?{'Access-Control-Allow-Origin':allowed,'Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type,If-Match','Vary':'Origin'}:{};
  const security={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",...cors};
  if(request.method==='OPTIONS')return new Response(null,{status:origin===allowed?204:403,headers:security});
  try{const response=await route(request,env);const result=new Response(response.body,response);for(const [k,v]of Object.entries(security))result.headers.set(k,v);return result;}
  catch(error){const status=error instanceof HttpError?error.status:500;if(status===500)console.error(JSON.stringify({event:'api_error',path:new URL(request.url).pathname}));return Response.json({error:status===500?'internal_error':error.message},{status,headers:{...security,...(status===429?{'Retry-After':'60'}:{})}});}
}
export async function scheduledBackup(env){
  const data=await env.DB.prepare("SELECT document,version FROM catalog_store WHERE id='main'").first();if(!data)return;
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO snapshots(created_at,version,document) VALUES(?,?,?)').bind(new Date().toISOString(),data.version,data.document),
    env.DB.prepare('DELETE FROM snapshots WHERE created_at NOT IN (SELECT created_at FROM snapshots ORDER BY created_at DESC LIMIT 12)'),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now()),
    env.DB.prepare('DELETE FROM oauth_states WHERE expires_at<?').bind(now()),
    env.DB.prepare('DELETE FROM auth_codes WHERE expires_at<?').bind(now()),
    env.DB.prepare('DELETE FROM rate_limits WHERE window_start<?').bind(Math.floor(now()/60)-1440)
  ]);
}
export default {fetch:handleRequest,scheduled(controller,env,ctx){ctx.waitUntil(scheduledBackup(env));}};
