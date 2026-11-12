// One bounded background reconciliation at a time; all WA operations are GET.
// The owner's outreach pause is never changed and no customer is messaged.
import {reconcileWhatsappApprovals} from './whatsapp-approval-reconciliation.mjs';
let active=null;
let state={state:'IDLE',scanned:0,approved:0,unverified:0,errors:0,
 startedAt:null,completedAt:null,source:'2994',note:'Somente aceites encontrados no histórico real são autorizados'};
export const approvalSyncStatus=()=>({...state});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function runApprovalReconciliation({limit=15}={}){
 if(active)return approvalSyncStatus();
 if(process.env.PROSPECTOR_TENANT_ID)throw Error('Disponível somente na conta Consecom');
 if(process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE!=='true')
  throw Error('Pause a prospecção para reconciliar autorizações');
 let cursor='';
 state={state:'RUNNING',scanned:0,approved:0,unverified:0,errors:0,
  startedAt:new Date().toISOString(),completedAt:null,source:'2994',
  note:'Lendo apenas conversas do WhatsApp conectado, sem enviar mensagens'};
 active=(async()=>{
  try{
   for(let step=0;step<100;step++){
    const r=await reconcileWhatsappApprovals({cursor,limit,apply:true});
    if(r.status==='SOURCE_UNAVAILABLE'){
     state={...state,state:'SOURCE_UNAVAILABLE',note:r.reason};break;
    }
    state={...state,scanned:state.scanned+r.scanned,approved:state.approved+r.approved,
     unverified:state.unverified+r.notFound+r.invalid,
     errors:state.errors+r.gatewayErrors};
    if(r.scanned===0||!r.hasMore){state.state='COMPLETED';break;}
    if(r.nextCursor===cursor)throw Error('O cursor não avançou');
    cursor=r.nextCursor;
    if(r.gatewayErrors>=limit){
     state={...state,state:'SOURCE_ERROR',note:'O histórico do WhatsApp não está acessível'};
     break;
    }
    await sleep(320);
   }
   if(state.state==='RUNNING')state.state='PARTIAL';
  }catch(error){
   state={...state,state:'ERROR',note:String(error?.message||error).slice(0,160)};
  }finally{
   state.completedAt=new Date().toISOString();active=null;
   console.info('[approval history reconciliation]',JSON.stringify(state));
  }
 })();
 return approvalSyncStatus();
}
