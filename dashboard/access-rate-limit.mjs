// Forwarding headers are client input unless a trusted proxy is configured.
import {isIP} from 'node:net';
import {createHmac,timingSafeEqual} from 'node:crypto';
export function accessClientKey(req){
 const signedIp=String(req.headers['x-prospector-client-ip']||''),at=String(req.headers['x-prospector-client-at']||''),sig=String(req.headers['x-prospector-client-signature']||'');
 if(process.env.ADMIN_ACCESS_TOKEN&&isIP(signedIp)&&/^\d{13}$/.test(at)&&Math.abs(Date.now()-Number(at))<60000&&/^[a-f0-9]{64}$/.test(sig)){
  const expected=createHmac('sha256',process.env.ADMIN_ACCESS_TOKEN).update(signedIp+'|'+at).digest('hex');
  if(timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return 'proxy:'+signedIp;
 }
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
