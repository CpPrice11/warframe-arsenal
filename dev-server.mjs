import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {localDatabase} from './local-db.mjs';
import {handleRequest,randomToken,digest} from './worker.js';

const publicRoot=path.resolve(fileURLToPath(new URL('./public/',import.meta.url)));
const DB=localDatabase(fileURLToPath(new URL('./preview.sqlite',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
const port=Number(process.env.PORT||5181);
const origin='http://127.0.0.1:'+port;
const env={DB,FRONTEND_URL:origin+'/',OWNER_GITHUB_ID:'117557975'};
const server=http.createServer(async(req,res)=>{
  try{
    if(req.headers.host!=='127.0.0.1:'+port){res.writeHead(403);res.end();return;}
    const url=new URL(req.url,origin);
    if(url.pathname.startsWith('/api/')){
      const chunks=[];let total=0;for await(const chunk of req){total+=chunk.length;if(total>512000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
      const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
      let response;
      // This login exists only in the loopback development server, never in worker.js.
      if(url.pathname==='/api/auth/start'&&req.method==='POST'){
        if(req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end();return;}
        const token=randomToken();DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await digest(token),env.OWNER_GITHUB_ID,Math.floor(Date.now()/1000)+3600).run();response=Response.json({preview:true,token});
      }else{
        response=await handleRequest(request,env);
        if(url.pathname==='/api/catalog'&&response.ok)response=Response.json({...await response.json(),preview:true});
        if(url.pathname==='/api/admin/session'&&response.ok)response=Response.json({owner:true,preview:true});
      }
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    if(url.pathname==='/config.js'){res.writeHead(200,{'Content-Type':mime['.js'],'Cache-Control':'no-store'});res.end("export const config = { apiBase: '' };\n");return;}
    const relative=decodeURIComponent(url.pathname).replace(/^\/+/, '')||'index.html';
    const target=path.resolve(publicRoot,relative);
    if(!target.startsWith(publicRoot+path.sep)&&target!==path.join(publicRoot,'index.html')){res.writeHead(403);res.end();return;}
    const body=await readFile(target);
    res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' https:; style-src 'self'; script-src 'self'; connect-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"});res.end(req.method==='HEAD'?undefined:body);
  }catch(error){res.writeHead(error.code==='ENOENT'?404:500);res.end(error.code==='ENOENT'?'Not found':'Server error');}
});
server.listen(port,'127.0.0.1',()=>console.log(origin+'/'));
function stop(){server.close(()=>{DB.close();process.exit(0);});}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
