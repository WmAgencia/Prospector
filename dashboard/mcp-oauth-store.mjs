import crypto from 'node:crypto';
import {db,one,run,now,tx} from './db.mjs';
const configured=String(process.env.MCP_PUBLIC_URL||'');
let canonical=null;try{canonical=new URL(configured);if(canonical.pathname!=='/mcp'||canonical.search||canonical.hash||canonical.username||canonical.password||canonical.protocol!=='https:')canonical=null;}catch{}
export const ENABLED=process.env.MCP_ENABLED==='true'&&!!canonical;
export const RESOURCE=canonical?.href||'';
export const SITE=canonical?.origin||'';
export const SCOPES=['prospector:read','prospector:prepare','prospector:outreach'];
export const hash=v=>crypto.createHash('sha256').update(String(v||'')).digest('hex');
export const random=()=>crypto.randomBytes(36).toString('base64url');
export const eq=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&crypto.timingSafeEqual(x,y);};
db.exec('CREATE TABLE IF NOT EXISTS mcp_clients(id TEXT PRIMARY KEY,name TEXT NOT NULL,redirects TEXT NOT NULL,at TEXT NOT NULL)');
db.exec('CREATE TABLE IF NOT EXISTS mcp_codes(hash TEXT PRIMARY KEY,client_id TEXT NOT NULL,redirect TEXT NOT NULL,challenge TEXT NOT NULL,scope TEXT NOT NULL,resource TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0)');
db.exec('CREATE TABLE IF NOT EXISTS mcp_tokens(hash TEXT PRIMARY KEY,client_id TEXT NOT NULL,scope TEXT NOT NULL,resource TEXT NOT NULL,kind TEXT NOT NULL,expires INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,at TEXT NOT NULL)');
export function checkClient(client,redirect){const c=one('SELECT * FROM mcp_clients WHERE id=?',String(client||''));return !!(c&&JSON.parse(c.redirects).includes(redirect));}
export function validScope(scope){return typeof scope==='string'&&scope.length>0&&scope.split(' ').every(x=>SCOPES.includes(x));}
export function registerClient(data){
 const uris=data.redirect_uris;
 if(data.token_endpoint_auth_method&&data.token_endpoint_auth_method!=='none')throw Error('invalid_client_metadata');
 if(!Array.isArray(uris)||uris.length<1||uris.length>5||uris.some(x=>{try{const u=new URL(x);return typeof x!=='string'||x.length>500||u.protocol!=='https:'||!!u.hash||!!u.username||!!u.password;}catch{return true;}}))throw Error('invalid_redirect_uri');
 const id='prospector_'+crypto.randomBytes(18).toString('base64url');
 run('INSERT INTO mcp_clients VALUES(?,?,?,?)',id,String(data.client_name||'MCP client').slice(0,100),JSON.stringify(uris),now());
 return {client_id:id,client_name:String(data.client_name||'MCP client').slice(0,100),redirect_uris:uris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']};
}
export function putCode(data){const code=random();run('INSERT INTO mcp_codes(hash,client_id,redirect,challenge,scope,resource,expires) VALUES(?,?,?,?,?,?,?)',hash(code),data.client,data.redirect,data.challenge,data.scope,RESOURCE,Date.now()+300000);return code;}
function issue(client,scope){const access_token=random(),refresh_token=random(),time=Date.now();for(const [value,kind,ms] of [[access_token,'access',3600000],[refresh_token,'refresh',2592000000]])run('INSERT INTO mcp_tokens(hash,client_id,scope,resource,kind,expires,at) VALUES(?,?,?,?,?,?,?)',hash(value),client,scope,RESOURCE,kind,time+ms,now());return {access_token,refresh_token,token_type:'Bearer',scope,expires_in:3600};}
export function exchangeCode({client_id,redirect_uri,code,code_verifier,resource}){return tx(()=>{
 if(resource!==RESOURCE||!/^[-.\w~]{43,128}$/.test(String(code_verifier||'')))return null;
 const row=one('SELECT * FROM mcp_codes WHERE hash=? AND client_id=? AND redirect=? AND used=0 AND expires>?',hash(code),client_id,redirect_uri,Date.now());
 if(!row||row.resource!==RESOURCE||!checkClient(client_id,redirect_uri)||!eq(crypto.createHash('sha256').update(code_verifier).digest('base64url'),row.challenge))return null;
 run('UPDATE mcp_codes SET used=1 WHERE hash=?',hash(code));return issue(client_id,row.scope);
});}
export function refresh({client_id,refresh_token,resource,scope}){return tx(()=>{if(resource!==RESOURCE)return null;const t=one('SELECT * FROM mcp_tokens WHERE hash=? AND client_id=? AND kind=? AND revoked=0 AND expires>?',hash(refresh_token),client_id,'refresh',Date.now());if(!t||t.resource!==RESOURCE||(scope&&(!validScope(scope)||scope.split(' ').some(x=>!t.scope.split(' ').includes(x)))))return null;run('UPDATE mcp_tokens SET revoked=1 WHERE hash=?',hash(refresh_token));return issue(client_id,scope||t.scope);});}
export function verifyBearer(req){const token=String(req.headers.authorization||'').match(/^Bearer ([A-Za-z0-9_-]{25,})$/i)?.[1];if(!token)return null;const t=one('SELECT * FROM mcp_tokens WHERE hash=? AND kind=? AND revoked=0 AND expires>?',hash(token),'access',Date.now());return t?.resource===RESOURCE?t:null;}
