// Preview estático seguro: não possui acesso ao bot, ao banco nem ao WhatsApp.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=path.dirname(fileURLToPath(import.meta.url));
const allow=new Set(['index.html','style.css','mock.js','app.js']);
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const port=Number(process.env.PORT||process.env.PREVIEW_PORT||4173);
http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const file=pathname==='/'?'index.html':pathname.replace(/^\//,'');
 if(/^\/studio\/(?:projects\.json|sites\/[a-z0-9-]{2,80}\.html)$/.test(pathname)){
   const projectFile=path.resolve(directory,'..',pathname.slice(1));
   const studioRoot=path.resolve(directory,'..','studio');
   if(!projectFile.startsWith(studioRoot+path.sep)){res.writeHead(403);return res.end('Forbidden');}
   if(!fs.existsSync(projectFile)){res.writeHead(404);return res.end('Not Found');}
   res.writeHead(200,{'Content-Type':pathname.endsWith('.json')?'application/json; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   return fs.createReadStream(projectFile).pipe(res);
 }
 if(!allow.has(file)){res.writeHead(404);return res.end('Not Found');}
 const target=path.join(directory,file);
 res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'no-store'});
 fs.createReadStream(target).pipe(res);
}).listen(port,process.env.PORT?'0.0.0.0':'127.0.0.1',()=>console.log('Preview visual: http://127.0.0.1:'+port));
