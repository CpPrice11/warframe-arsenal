import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateCatalog,filterRecords,safeUrl} from './public/catalog-core.js';
import {messages,elementKeys} from './public/i18n.js';
import {localDatabase} from './local-db.mjs';
import {handleRequest,digest,randomToken,scheduledBackup} from './worker.js';

const source=JSON.parse(await readFile(new URL('./public/catalog.json',import.meta.url),'utf8'));
const base='https://api.example.test';
function fixture(){const DB=localDatabase();return {DB,FRONTEND_URL:'https://owner.github.io/arsenal/',OWNER_GITHUB_ID:'117557975'};}

test('personal arsenal is private and isolated from public catalog and revisions',async()=>{
  const env=fixture(),token=await authenticate(env),foreign=await authenticate(env,'999'),expired=await authenticate(env,env.OWNER_GITHUB_ID,1);
  const marks={id:source.weapons[0].id,owned:true,wanted:true,mastered:false};
  for(const credential of [undefined,foreign,expired,randomToken()])for(const method of ['GET','PUT']){
    const response=await call(env,'/api/admin/arsenal',{method,token:credential,...(method==='PUT'?{body:marks,headers:{'If-Match':'0'}}:{})});
    assert.ok([401,403].includes(response.status));
  }
  const before=await (await call(env,'/api/catalog')).json();
  const saved=await call(env,'/api/admin/arsenal',{method:'PUT',token,body:marks,headers:{'If-Match':'0'}});assert.equal(saved.status,200);
  assert.equal(saved.headers.get('Cache-Control'),'no-store');assert.deepEqual(await saved.json(),{...marks,revision:1});
  const otherDevice=await authenticate(env);
  assert.deepEqual(await (await call(env,'/api/admin/arsenal',{token:otherDevice})).json(),[{...marks,revision:1}]);
  assert.deepEqual(await (await call(env,'/api/catalog')).json(),before);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM revisions').get().n,0);
  assert.equal((await call(env,'/api/admin/arsenal',{method:'PUT',token,body:marks,headers:{'If-Match':'1'},origin:'https://evil.test'})).status,403);
  env.DB.close();
});

test('personal marks reject stale writes and keep per-weapon revisions after clearing',async()=>{
  const env=fixture(),token=await authenticate(env),id=source.weapons[0].id;
  const put=(body,revision)=>call(env,'/api/admin/arsenal',{method:'PUT',token,body,headers:{'If-Match':String(revision)}});
  assert.equal((await put({id,owned:false,wanted:true,mastered:true},0)).status,200);
  const independent=await (await call(env,'/api/admin/arsenal',{token})).json();assert.equal(independent[0].mastered,true);assert.equal(independent[0].owned,false);assert.equal(independent[0].wanted,true);
  assert.equal((await put({id,owned:false,wanted:true,mastered:false},0)).status,409);
  const cleared=await put({id,owned:false,wanted:false,mastered:false},1);assert.equal(cleared.status,200);assert.equal((await cleared.json()).revision,2);
  assert.equal((await put({id,owned:true,wanted:false,mastered:false},1)).status,409);
  assert.equal((await put({id:source.weapons[1].id,owned:true,wanted:false,mastered:false},0)).status,200);
  assert.equal((await put({id,owned:true,wanted:false,mastered:false},2)).status,200);
  env.DB.close();
});

test('personal arsenal validates bounded input, active weapon IDs and rate limits',async()=>{
  const env=fixture(),token=await authenticate(env),good={id:source.weapons[0].id,owned:true,wanted:false,mastered:false};
  const put=(body,revision='0')=>call(env,'/api/admin/arsenal',{method:'PUT',token,body,headers:{'If-Match':revision}});
  for(const body of [null,[],true,{...good,owned:1},{...good,mastered:'true'},{...good,id:'../bad'},{...good,user_id:'999'}])assert.equal((await put(body)).status,400);
  assert.equal((await put({...good,id:source.progenitors[0].id})).status,404);
  assert.equal((await put({...good,id:'nonexistent-weapon'})).status,404);
  env.DB.prepare("UPDATE catalog_store SET document=json_set(document,'$.weapons[0].archived',json('true')) WHERE id='main'").run();
  assert.equal((await put(good)).status,404);
  assert.equal((await put(good,'-1')).status,428);assert.equal((await put(good,'0'.repeat(10))).status,428);
  assert.equal((await put({...good,extra:'a'.repeat(1100)})).status,413);
  env.DB.prepare('INSERT INTO rate_limits(key,window_start,count) VALUES(?,?,60) ON CONFLICT(key) DO UPDATE SET count=60,window_start=excluded.window_start').bind('arsenal-write:'+env.OWNER_GITHUB_ID,Math.floor(Date.now()/60000)).run();
  const limited=await put(good);assert.equal(limited.status,429);assert.equal(limited.headers.get('Retry-After'),'60');
  env.DB.close();
});
const call=(env,path,{method='GET',token,body,version,origin='https://owner.github.io',headers={}}={})=>handleRequest(new Request(base+path,{method,headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...(version?{'If-Match':String(version)}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env);
async function authenticate(env,user=env.OWNER_GITHUB_ID,expires=Math.floor(Date.now()/1000)+3600){const token=randomToken();env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await digest(token),user,expires).run();return token;}

test('live import, exact counts, all image files and locale parity',async()=>{
  validateCatalog(source);assert.equal(source.weapons.length,51);assert.equal(source.progenitors.length,66);assert.equal(source.tips.length,34);
  for(const locale of Object.values(messages)){
    assert.deepEqual(Object.keys(messages.uk).sort(),Object.keys(locale).sort());
    for(const key of Object.keys(messages.uk))assert.deepEqual(locale[key].match(/\{\w+\}/g)||[],messages.uk[key].match(/\{\w+\}/g)||[],key);
  }
  assert.deepEqual(['Kuva','Tenet','Coda'].map(f=>source.weapons.filter(w=>w.family===f).length),[21,16,14]);
  for(const r of [...source.weapons,...source.progenitors]){assert.ok(r.image);const bytes=await readFile(new URL('./public/'+r.image,import.meta.url));assert.equal(bytes.subarray(1,4).toString(),'PNG');}
});
test('all seven original Wiki element icons retain correct sources and 64px PNGs',async()=>{
  const {assets}=JSON.parse(await readFile(new URL('./public/ELEMENT-SOURCES.json',import.meta.url),'utf8'));
  assert.deepEqual(assets.map(a=>a.key).sort(),[...elementKeys].sort());
  for(const asset of assets){
    const wikiName=asset.key==='electric'?'Electricity':asset.key[0].toUpperCase()+asset.key.slice(1);
    assert.equal(new URL(asset.source).origin,'https://wiki.warframe.com');
    assert.equal(new URL(asset.source).pathname,'/images/Dmg'+wikiName+'Small64.png');
    const bytes=await readFile(new URL('./public/'+asset.file,import.meta.url));
    assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.readUInt32BE(16),64);assert.equal(bytes.readUInt32BE(20),64);
  }
});
test('Russian catalog is complete, searchable and validates translated input',async()=>{
  for(const r of [...source.weapons,...source.progenitors])assert.ok(r.name_ru&&r.reason_ru,r.id);
  for(const r of source.weapons){
    assert.ok(r.mechanic_ru&&r.obtain_ru,r.id);
    for(const [element,value] of Object.entries(r.matrix)){
      assert.ok(r.matrix_ru[element]);assert.equal(r.matrix_ru[element].split(' • ')[0],value.split(' • ')[0]);
    }
  }
  for(const r of source.tips)assert.ok(r.title_ru&&r.body_ru,r.id);
  const names=JSON.parse(await readFile(new URL('./public/RUSSIAN-NAMES-SOURCES.json',import.meta.url),'utf8'));
  assert.equal(names.records.length,117);
  for(const r of [...source.weapons,...source.progenitors])assert.equal(names.records.find(x=>x.id===r.id)?.name_ru,r.name_ru);
  assert.equal(filterRecords(source,{search:'НЮКОР',lang:'ru'})[0].id,'kuva-nukor');
  assert.equal(filterRecords(source,{section:'guides',search:'Валентное слияние',lang:'ru'}).length,2);
  assert.deepEqual([1,2,5,21].map(n=>new Intl.PluralRules('ru').select(n)),['one','few','many','one']);
  const changed=structuredClone(source);changed.weapons[0].reason_ru={text:'invalid'};assert.throws(()=>validateCatalog(changed));
  changed.weapons[0].reason_ru='';changed.weapons[0].matrix_ru={electric:'x'.repeat(1001)};assert.throws(()=>validateCatalog(changed));
});
test('search, family, type and element filters compose correctly',()=>{
  assert.equal(filterRecords(source,{search:'NUKOR'}).length,1);
  assert.equal(filterRecords(source,{search:'нюкор'}).length,1);
  assert.equal(filterRecords(source,{section:'Coda'}).length,14);
  assert.equal(filterRecords(source,{search:'no-such-weapon'}).length,0);
  assert.ok(filterRecords(source,{section:'Tenet',type:'secondary',element:'magnetic'}).every(w=>w.family==='Tenet'&&w.type==='secondary'&&w.recommended==='magnetic'));
  assert.equal(filterRecords(source,{section:'progenitors'}).length,66);
});
test('full multilingual seed fits D1 statement limits and preserves an existing catalog',async()=>{
  const sql=await readFile(new URL('./seed.sql',import.meta.url),'utf8');
  for(const statement of sql.trim().split('\n'))assert.ok(Buffer.byteLength(statement)<100000);
  const DB=localDatabase();
  try{
    DB.sqlite.exec("DELETE FROM catalog_store;"+sql);
    assert.deepEqual(JSON.parse(DB.prepare("SELECT document FROM catalog_store WHERE id='main'").first().document),source);
    const changed=structuredClone(source);changed.weapons[0].reason_ru='Сохранённая правка';
    DB.prepare("UPDATE catalog_store SET document=?,version=2 WHERE id='main'").bind(JSON.stringify(changed)).run();
    DB.sqlite.exec(sql);
    assert.deepEqual(JSON.parse(DB.prepare("SELECT document FROM catalog_store WHERE id='main'").first().document),changed);
  }finally{DB.close();}
});
test('URL boundary and schema reject dangerous links and duplicate ids',()=>{
  for(const url of ['javascript:alert(1)','http://overframe.gg/build/123/test/','https://overframe.gg.evil.test/build/123/test/','https://overframe.gg:444/build/123/test/','https://me@overframe.gg/build/123/test/','https://127.0.0.1/build/123/test/'])assert.equal(safeUrl(url,{build:true}),false);
  const changed=structuredClone(source);changed.weapons[1].id=changed.weapons[0].id;assert.throws(()=>validateCatalog(changed));
  changed.weapons[1].id='different';changed.weapons[0].matrix={other:'S'};assert.throws(()=>validateCatalog(changed));
});
test('anonymous, expired, forged, wrong-owner sessions cannot write',async()=>{
  const env=fixture();try{
    assert.equal((await call(env,'/api/catalog')).status,200);
    for(const token of [undefined,randomToken(),await authenticate(env,'someone-else'),await authenticate(env,env.OWNER_GITHUB_ID,1)]){
      const r=await call(env,'/api/admin/catalog',{method:'PUT',body:source,token,version:1});assert.ok([401,403].includes(r.status));
    }
    assert.equal(env.DB.prepare("SELECT version FROM catalog_store WHERE id='main'").first().version,1);
  }finally{env.DB.close();}
});
test('owner writes are atomic, keep revision history and reject stale versions',async()=>{
  const env=fixture();try{
    const token=await authenticate(env);const changed=structuredClone(source);changed.weapons[0].reason_uk='Тест збереження';
    assert.equal((await call(env,'/api/admin/catalog',{method:'PUT',token,body:changed,version:1,origin:'https://attacker.test'})).status,403);
    assert.equal((await call(env,'/api/admin/catalog',{method:'PUT',token,body:changed})).status,428);
    const saved=await call(env,'/api/admin/catalog',{method:'PUT',token,body:changed,version:1});assert.deepEqual(await saved.json(),{version:2});
    const previous=await call(env,'/api/admin/history/1',{token});assert.deepEqual(await previous.json(),source);
    assert.equal((await call(env,'/api/admin/catalog',{method:'PUT',token,body:source,version:1})).status,409);
    assert.equal((await (await call(env,'/api/catalog')).json()).catalog.weapons[0].reason_uk,'Тест збереження');
    changed.weapons[0].build_url='javascript:alert(1)';assert.equal((await call(env,'/api/admin/catalog',{method:'PUT',token,body:changed,version:2})).status,400);
    assert.equal((await (await call(env,'/api/admin/history',{token})).json()).length,1);
    assert.equal((await call(env,'/api/admin/catalog',{method:'PUT',token,body:source,version:2})).status,200);
    assert.equal((await (await call(env,'/api/catalog')).json()).version,3);
  }finally{env.DB.close();}
});
test('body limits apply to streamed bodies without Content-Length',async()=>{
  const env=fixture();try{const token=await authenticate(env);const request=new Request(base+'/api/admin/catalog',{method:'PUT',headers:{Origin:'https://owner.github.io',Authorization:'Bearer '+token,'Content-Type':'application/json','If-Match':'1'},body:' '.repeat(512001)});assert.equal((await handleRequest(request,env)).status,413);}finally{env.DB.close();}
});
test('OAuth uses PKCE, first-party cookie, one-use codes and verified GitHub owner',async()=>{
  const env=fixture();const originalFetch=globalThis.fetch;
  env.GITHUB_CLIENT_ID='test-client-id';env.GITHUB_CLIENT_SECRET='test-only-placeholder';
  try{
    const verifier=randomToken();const start=await call(env,'/api/auth/start',{method:'POST',body:{challenge:await digest(verifier)}});assert.equal(start.status,200);
    const beginUrl=(await start.json()).url;assert.equal(new URL(beginUrl).pathname,'/auth/begin');
    const begin=await handleRequest(new Request(beginUrl),env);assert.equal(begin.status,303);const cookie=begin.headers.get('Set-Cookie');assert.match(cookie,/Secure; HttpOnly; SameSite=Lax/);
    const github=new URL(begin.headers.get('Location'));assert.equal(github.origin,'https://github.com');assert.equal(github.searchParams.get('scope'),'');assert.equal(github.searchParams.get('code_challenge_method'),'S256');
    const state=github.searchParams.get('state');
    assert.equal((await handleRequest(new Request(base+'/auth/callback?code=test&state='+state),env)).status,400);
    globalThis.fetch=async(url,options)=>{if(String(url).includes('access_token')){assert.ok(options.body.get('code_verifier'));return Response.json({access_token:'test-github-token'});}assert.equal(String(url),'https://api.github.com/user');return Response.json({id:Number(env.OWNER_GITHUB_ID)});};
    const callback=await handleRequest(new Request(base+'/auth/callback?code=test&state='+state,{headers:{Cookie:cookie.split(';')[0]}}),env);assert.equal(callback.status,303);
    const destination=new URL(callback.headers.get('Location'));assert.equal(destination.origin,'https://owner.github.io');const code=new URLSearchParams(destination.hash.slice(1)).get('login');
    assert.equal((await call(env,'/api/auth/exchange',{method:'POST',body:{code,verifier:randomToken()}})).status,403);
    const exchange=await call(env,'/api/auth/exchange',{method:'POST',body:{code,verifier}});assert.equal(exchange.status,200);const {token}=await exchange.json();assert.equal((await call(env,'/api/admin/session',{token})).status,200);
    assert.equal((await call(env,'/api/auth/exchange',{method:'POST',body:{code,verifier}})).status,403);
    assert.equal((await call(env,'/api/admin/logout',{method:'POST',token})).status,200);assert.equal((await call(env,'/api/admin/session',{token})).status,403);
    // A different GitHub identity must never receive an exchange code.
    const second=await call(env,'/api/auth/start',{method:'POST',body:{challenge:await digest(verifier)}});const secondUrl=(await second.json()).url;const secondBegin=await handleRequest(new Request(secondUrl),env);const secondGithub=new URL(secondBegin.headers.get('Location'));
    globalThis.fetch=async(url)=>Response.json(String(url).includes('access_token')?{access_token:'test-token'}:{id:999});
    const rejected=await handleRequest(new Request(base+'/auth/callback?code=test&state='+secondGithub.searchParams.get('state'),{headers:{Cookie:secondBegin.headers.get('Set-Cookie').split(';')[0]}}),env);assert.equal(rejected.status,403);
  }finally{globalThis.fetch=originalFetch;env.DB.close();}
});
test('link audit takes stored URL, rejects unsafe redirects, never changes manual data',async()=>{
  const env=fixture();const originalFetch=globalThis.fetch;
  try{const token=await authenticate(env);let calls=0;globalThis.fetch=async(url)=>{calls++;assert.equal(String(url),source.weapons[0].build_url);return new Response(null,{status:302,headers:{Location:'http://127.0.0.1/private'}});};
    const check=await call(env,'/api/admin/check-build',{method:'POST',token,body:{id:source.weapons[0].id,url:'http://127.0.0.1/private'}});assert.equal(check.status,200);assert.equal((await check.json()).status,null);assert.equal(calls,1);
    const current=await (await call(env,'/api/catalog')).json();assert.equal(current.version,1);assert.deepEqual(current.catalog,source);
  }finally{globalThis.fetch=originalFetch;env.DB.close();}
});
test('login endpoint rate limit and CORS allow only configured frontend',async()=>{
  const env=fixture();env.GITHUB_CLIENT_ID='test';env.GITHUB_CLIENT_SECRET='test';try{
    for(let i=0;i<5;i++)assert.equal((await call(env,'/api/auth/start',{method:'POST',body:{challenge:randomToken()}})).status,200);
    assert.equal((await call(env,'/api/auth/start',{method:'POST',body:{challenge:randomToken()}})).status,429);
    assert.equal((await call(env,'/api/catalog',{origin:'https://attacker.test'})).headers.get('Access-Control-Allow-Origin'),null);
    assert.equal((await call(env,'/api/catalog')).headers.get('Access-Control-Allow-Origin'),'https://owner.github.io');
  }finally{env.DB.close();}
});
test('scheduled snapshot preserves data and clears expired auth state',async()=>{
  const env=fixture();try{await authenticate(env,env.OWNER_GITHUB_ID,1);await scheduledBackup(env);assert.equal(env.DB.prepare('SELECT count(*) AS n FROM snapshots').first().n,1);assert.equal(env.DB.prepare('SELECT count(*) AS n FROM sessions').first().n,0);assert.deepEqual(JSON.parse(env.DB.prepare('SELECT document FROM snapshots').first().document),source);}finally{env.DB.close();}
});
