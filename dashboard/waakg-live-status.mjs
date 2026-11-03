// Cache the ACTUAL WA-AKG transport state for the synchronous dashboard
// snapshot. Legacy Baileys runs separately and is intentionally disabled when
// WHATSAPP_TRANSPORT=waakg. Never equate its disconnected status to WA-AKG.
import {waControlStatus} from './waakg-control.mjs';
let latest={status:'VERIFYING',connected:false,ok:false,message:null,checkedAt:0};
let pending=null;
export function gatewayConnectionView(legacy,{transport=process.env.WHATSAPP_TRANSPORT,at=Date.now()}={}){
 if(transport!=='waakg')return legacy;
 const stale=!latest.checkedAt||at-latest.checkedAt>60000;
 return {...legacy,
  status:stale?'VERIFYING':latest.connected?'CONNECTED':latest.status,
  qr:null,user:null,
  error:stale?null:latest.ok?null:(latest.message||'WA-AKG não respondeu ao diagnóstico'),
  provider:'WA-AKG',connected:!stale&&latest.connected,
  connectionNotTested:stale};
}
export async function refreshGatewayConnection({read=waControlStatus}={}){
 if(pending)return pending;
 pending=(async()=>{
  try{
   const state=await read();
   latest={ok:state?.ok===true,connected:state?.connected===true,
    status:String(state?.status||'ERROR').slice(0,60),
    message:state?.ok?null:String(state?.message||'Falha na consulta WA-AKG').slice(0,120),
    checkedAt:Date.now()};
  }catch(e){
   latest={ok:false,connected:false,status:'ERROR',message:'Gateway indisponível',checkedAt:Date.now()};
  }
  return {...latest};
 })().finally(()=>{pending=null});
 return pending;
}
