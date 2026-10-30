import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('full dashboard routes MCP before browser origin/session middleware',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mcp-server-smoke-'));
 const reservation=http.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const env={...process.env,PROSPECTOR_DATA_DIR:temp,MCP_ENABLED:'true',MCP_PUBLIC_URL:'https://public.example/mcp',PORT:String(port),WHATSAPP_TRANSPORT:'waakg',NODE_ENV:'development',WA_AKG_BASE_URL:'',WA_AKG_API_KEY:'',GROQ_API_KEY:'',BRAVE_SEARCH_API_KEY:''};
 const child=spawn(process.execPath,['dashboard/server.mjs'],{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',c=>logs+=c);child.stderr.on('data',c=>logs+=c);
 try{
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('startup timed out '+logs)),10000);const check=c=>{if(String(c).includes('Prospector:')){clearTimeout(timeout);resolve();}};child.stdout.on('data',check);child.once('exit',code=>{clearTimeout(timeout);reject(Error('startup exit '+code+' '+logs));});});
  const base='http://127.0.0.1:'+port;
  const discovery=await fetch(base+'/.well-known/oauth-protected-resource/mcp',{headers:{origin:'https://public.example'}});assert.equal(discovery.status,200);
  const mcp=await fetch(base+'/mcp',{method:'POST',headers:{origin:'https://public.example','content-type':'application/json'},body:'{}'});assert.equal(mcp.status,401);assert.match(mcp.headers.get('www-authenticate'),/resource_metadata/);
  assert.equal((await fetch(base+'/mcp',{headers:{origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(base+'/oauth/register',{method:'POST',headers:{origin:'https://public.example','content-type':'application/json'},body:JSON.stringify({redirect_uris:['https://client.example/cb']})})).status,201);
 }finally{child.kill('SIGKILL');await once(child,'exit');fs.rmSync(temp,{recursive:true,force:true});}
});
