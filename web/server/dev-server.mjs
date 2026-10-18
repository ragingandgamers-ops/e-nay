import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import worker,{passwordHash} from './worker.mjs';
import {localDatabase} from './local-db.mjs';
import {SCHEMA} from './schema.mjs';
const testMode=process.argv.includes('--test');
const port=Number(process.env.PORT||8765),root=new URL('../dist/',import.meta.url);
if(!testMode)await mkdir(new URL('../../data/local-web/',import.meta.url),{recursive:true});
const db=localDatabase(testMode?':memory:':fileURLToPath(new URL('../../data/local-web/clinic.sqlite',import.meta.url)));
await db.exec(SCHEMA);
if(testMode){
 const password=await passwordHash('Fictional-test-password-2026!');
 for(const [username,role] of [['test.staff','staff'],['test.patient','patient'],['other.patient','patient']])await db.prepare('INSERT INTO accounts(id,username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),username,'Fictional '+username,password,role,Date.now()).run();
}
const mime={html:'text/html',mjs:'application/javascript',js:'application/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',webp:'image/webp',webmanifest:'application/manifest+json'};
const assets={async fetch(request){
 const path=new URL(request.url).pathname;
 if(path==='/index.html')return new Response(null,{status:308,headers:{Location:'/'}});
 const name=['/','/start'].includes(path)?'index.html':path.slice(1);
 if(!/^(?:[\w.-]+|assets\/[\w.-]+)$/.test(name)||name==='_worker.js')return new Response('Not found',{status:404});
 try{return new Response(request.method==='HEAD'?null:await readFile(new URL(name,root)),{headers:{'Content-Type':mime[name.split('.').pop()]||'application/octet-stream','Cache-Control':'no-store'}});}catch{return new Response('Not found',{status:404});}
}};
const server=createServer(async(req,res)=>{
 try{
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1600000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
  const request=new Request(`http://127.0.0.1:${port}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
  const response=await worker.fetch(request,{DB:db,ASSETS:assets,DEVELOPMENT:'true'});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500);res.end('Local server error');}
});
server.listen(port,'127.0.0.1',()=>console.log(`E-Nay account preview: http://127.0.0.1:${port}/ ${testMode?'(disposable fictional test data)':''}`));
const close=()=>server.close(()=>{db.close();process.exit(0);});process.on('SIGINT',close);process.on('SIGTERM',close);
