import crypto from 'node:crypto';
import {db,one,run,now} from './db.mjs';
export const SITE='https://prospector-consecom-preview.vercel.app';
export const RESOURCE=SITE+'/mcp';
export const hash=v=>crypto.createHash('sha256').update(String(v||'')).digest('hex');
export const random=()=>crypto.randomBytes(36).toString('base64url');
export const eq=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&crypto.timingSafeEqual(x,y);};
db.exec('CREATE TABLE IF NOT EXISTS mcp_clients(id TEXT PRIMARY KEY,name TEXT NOT NULL,redirects TEXT NOT NULL,at TEXT NOT NULL)');
db.exec('CREATE TABLE IF NOT EXISTS mcp_codes(hash TEXT PRIMARY KEY,client_id TEXT NOT NULL,redirect TEXT NOT NULL,challenge TEXT NOT NULL,scope TEXT NOT NULL,resource TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0)');
db.exec('CREATE TABLE IF NOT EXISTS mcp_tokens(hash TEXT PRIMARY KEY,client_id TEXT NOT NULL,scope TEXT NOT NULL,resource TEXT NOT NULL,kind TEXT NOT NULL,expires INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,at TEXT NOT NULL)');
export function checkClient(client,redirect){const c=one('SELECT * FROM mcp_clients WHERE id=?',String(client||''));return !!(c&&JSON.parse(c.redirects).includes(redirect));}
export function registerClient(data){
 const uris=data.redirect_uris;
 if(!Array.isArray(uris)||uris.length<1||uris.length>5||uris.some(x=>typeof x!=='string'||x.length>500||!/^https:\/\//.test(x)))throw Error('invalid_redirect_uri');
 const id='prospector_'+crypto.randomBytes(18).toString('base64url');
 run('INSERT INTO mcp_clients VALUES(?,?,?,?)',id,String(data.client_name||'ChatGPT').slice(0,100),JSON.stringify(uris),now());
 return {client_id:id,client_name:String(data.client_name||'ChatGPT').slice(0,100),redirect_uris:uris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']};
}
export function putCode(data){
 const code=random();
 run('INSERT INTO mcp_codes(hash,client_id,redirect,challenge,scope,resource,expires) VALUES(?,?,?,?,?,?,?)',hash(code),data.client,data.redirect,data.challenge,data.scope,RESOURCE,Date.now()+300000);
 return code;
}
export function exchangeCode({client_id,redirect_uri,code,code_verifier,resource}){
 if(resource&&resource!==RESOURCE)return null;
 const row=one('SELECT * FROM mcp_codes WHERE hash=? AND client_id=? AND redirect=? AND used=0 AND expires>?',hash(code),client_id,redirect_uri,Date.now());
 if(!row||row.resource!==RESOURCE||!checkClient(client_id,redirect_uri))return null;
 const challenge=crypto.createHash('sha256').update(String(code_verifier||'')).digest('base64url');
 if(!eq(challenge,row.challenge))return null;
 run('UPDATE mcp_codes SET used=1 WHERE hash=?',hash(code));
 return issue(client_id,row.scope);
}
export function refresh({client_id,refresh_token,resource}){
 if(resource&&resource!==RESOURCE)return null;
 const t=one('SELECT * FROM mcp_tokens WHERE hash=? AND client_id=? AND kind=? AND revoked=0 AND expires>?',hash(refresh_token),client_id,'refresh',Date.now());
 if(!t||t.resource!==RESOURCE)return null;
 run('UPDATE mcp_tokens SET revoked=1 WHERE hash=?',hash(refresh_token));
 return issue(client_id,t.scope);
}
function issue(client,scope){
 const access_token=random(),refresh_token=random(),time=Date.now();
 for(const [value,kind,ms] of [[access_token,'access',3600000],[refresh_token,'refresh',2592000000]])
  run('INSERT INTO mcp_tokens(hash,client_id,scope,resource,kind,expires,at) VALUES(?,?,?,?,?,?,?)',hash(value),client,scope,RESOURCE,kind,time+ms,now());
 return {access_token,refresh_token,token_type:'Bearer',scope,expires_in:3600};
}
export function verifyBearer(req){
 const token=String(req.headers.authorization||'').match(/^Bearer ([A-Za-z0-9_-]{25,})$/)?.[1];
 if(!token)return null;
 const t=one('SELECT * FROM mcp_tokens WHERE hash=? AND kind=? AND revoked=0 AND expires>?',hash(token),'access',Date.now());
 return t?.resource===RESOURCE?t:null;
}
