// Brand avatar generated in memory for the private Meu Prospector group.
// No external image host, no customer data, no browser assets.
import {deflateSync} from 'node:zlib';
import {getGatewayApiKey} from './waakg-control.mjs';
import {one,run,now,audit,db} from './db.mjs';
const GROUP=/^\d{8,30}@g\.us$/;
const SID=/^[a-zA-Z0-9_-]{3,70}$/;
const PNG_SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const W=256,H=256;
const crcTable=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}
function chunk(type,data){
 const name=Buffer.from(type),all=Buffer.concat([name,data]);
 let crc=0xffffffff;
 for(const b of all)crc=crcTable[(crc^b)&255]^(crc>>>8);
 const length=Buffer.alloc(4),sum=Buffer.alloc(4);
 length.writeUInt32BE(data.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);
 return Buffer.concat([length,all,sum]);
}
function insideRounded(x,y,left,top,right,bottom,r){
 if(x<left||x>=right||y<top||y>=bottom)return false;
 const cx=Math.max(left+r,Math.min(right-r-1,x));
 const cy=Math.max(top+r,Math.min(bottom-r-1,y));
 return (x-cx)**2+(y-cy)**2<=r*r;
}
export function defaultProspectorAvatar(){
 const raw=Buffer.alloc(H*(1+W*4));
 for(let y=0;y<H;y++){
  const offset=y*(1+W*4);raw[offset]=0;
  for(let x=0;x<W;x++){
   let r=13+Math.floor(y/30),g=18+Math.floor(y/27),b=33+Math.floor(y/20);
   // Amber loop and bold shaft: geometric P monogram, recognizable at icon size.
   const loopOuter=insideRounded(x,y,66,58,198,170,38);
   const loopInner=insideRounded(x,y,94,85,166,143,18);
   const shaft=insideRounded(x,y,66,59,96,207,10);
   const highlight=insideRounded(x,y,80,60,88,204,3);
   if((loopOuter&&!loopInner)||shaft){r=255;g=143-Math.floor(y/22);b=43;}
   if(highlight){r=255;g=186;b=94;}
   const pos=offset+1+x*4;raw[pos]=r;raw[pos+1]=g;raw[pos+2]=b;raw[pos+3]=255;
  }
 }
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([PNG_SIGNATURE,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
db.exec("CREATE TABLE IF NOT EXISTS prospector_private_group_avatar (group_jid TEXT PRIMARY KEY, status TEXT NOT NULL, attempted_at TEXT, error TEXT)");
export async function applyDefaultGroupAvatar({sessionId,groupJid,upload}={}){
 if(!SID.test(String(sessionId||''))||!GROUP.test(String(groupJid||'')))return {status:'INVALID'};
 const previous=one('SELECT status,attempted_at FROM prospector_private_group_avatar WHERE group_jid=?',groupJid);
 if(previous?.status==='DONE')return {status:'ALREADY_SET'};
 if(previous?.attempted_at&&Date.parse(previous.attempted_at)>Date.now()-6*3600_000)return {status:'COOLDOWN'};
 run('INSERT INTO prospector_private_group_avatar(group_jid,status,attempted_at) VALUES(?,?,?) ON CONFLICT(group_jid) DO UPDATE SET status=excluded.status,attempted_at=excluded.attempted_at',groupJid,'ATTEMPTED',now());
 try{
  if(upload)await upload({sessionId,groupJid,png:defaultProspectorAvatar()});
  else{
   const key=await getGatewayApiKey(),file=defaultProspectorAvatar(),body=new FormData();
   body.append('file',new Blob([file],{type:'image/png'}),'meu-prospector.png');
   const uri='https://wa-akg-production-f9f0.up.railway.app/api/groups/'+encodeURIComponent(sessionId)+'/'+encodeURIComponent(groupJid)+'/picture';
   const res=await fetch(uri,{method:'PUT',headers:{'X-API-Key':key,Accept:'application/json'},body,signal:AbortSignal.timeout(22000)});
   const result=await res.json().catch(()=>({}));
   if(!res.ok||result.status!==true)throw Error('AVATAR_NOT_CONFIRMED');
  }
  run('UPDATE prospector_private_group_avatar SET status=?,error=NULL WHERE group_jid=?','DONE',groupJid);
  audit('PRIVATE_GROUP_AVATAR_SET',null,{group:true,confirmed:true});
  return {status:'DONE'};
 }catch(e){
  run('UPDATE prospector_private_group_avatar SET status=?,error=? WHERE group_jid=?','REVIEW',String(e?.message||e).slice(0,80),groupJid);
  return {status:'REVIEW'};
 }
}
