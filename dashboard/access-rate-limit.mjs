// Forwarding headers are client input unless a trusted proxy is configured.
import {isIP} from 'node:net';
export function accessClientKey(req){
 if(process.env.PROSPECTOR_TRUST_PROXY==='true'){
  const ip=String(req.headers['x-forwarded-for']||'').split(',').at(-1).trim();
  if(isIP(ip))return ip;
 }
 return req.socket.remoteAddress||'unknown';
}
export function createAccessLimiter({maxEntries=10000,windowMs=600000,limit=8}={}){
 const attempts=new Map();
 return {
  blocked(key,now=Date.now()){
   for(const [ip,item] of attempts)if(item.reset<=now)attempts.delete(ip);
   // At capacity, reject new identities rather than evict active limits.
   return (attempts.get(key)?.count||0)>=limit||(!attempts.has(key)&&attempts.size>=maxEntries);
  },
  failed(key,now=Date.now()){
   const item=attempts.get(key);
   if(item&&item.reset>now)item.count++;
   else if(attempts.has(key)||attempts.size<maxEntries)attempts.set(key,{count:1,reset:now+windowMs});
  },
  clear(key){attempts.delete(key);},
 };
}
