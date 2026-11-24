// Read-only, opt-in diagnostic for a specific case requested by the operator.
// The contact phone is supplied only through a private environment variable.
// Never prints names, raw messages, message IDs, or phone numbers.
import {one,all} from './db.mjs';
import {waRequest} from './waakg-control.mjs';
import {acceptsProposalAudio} from './prospector-sales-signals.mjs';
import {wantsPortfolioPitchAudio} from './portfolio-pitch-audio.mjs';

const epoch=value=>{
 const v=Date.parse(String(value||''));
 return Number.isFinite(v)?v:0;
};
export async function inspectDeliveryCase(phone,{fetchChat=waRequest}={}){
 if(!/^55\d{10,11}$/.test(String(phone||'')))return {state:'INVALID_TARGET'};
 const lead=one('SELECT id,stage FROM leads WHERE phone=?',phone);
 if(!lead)return {state:'LEAD_NOT_FOUND',suffix:String(phone).slice(-4)};
 const intro=one('SELECT stage,reason,session_id,phone,created_at,sent_at,due_at,followup_status FROM prospecting_introductions WHERE lead_id=?',lead.id);
 const thread=one('SELECT id,manual_takeover FROM threads WHERE lead_id=?',lead.id);
 const inbox=all('SELECT body,state,received_at,session_id FROM waakg_inbox WHERE lead_id=? ORDER BY received_at DESC LIMIT 12',lead.id);
 const receipts=all('SELECT kind,status,provider_id,attempted_at FROM pitch_delivery_receipts WHERE lead_id=? ORDER BY attempted_at DESC LIMIT 8',lead.id);
 const local=thread?all("SELECT provider_id,type,at FROM messages WHERE thread_id=? AND direction='out' ORDER BY at DESC LIMIT 20",thread.id):[];
 const since=epoch(intro?.sent_at||intro?.created_at);
 let remote={state:'NOT_CHECKED'};
 if(intro?.session_id&&intro?.phone){
  try{
   const reply=await fetchChat('/api/chat/'+encodeURIComponent(intro.session_id)+'/'+encodeURIComponent(intro.phone+'@s.whatsapp.net'));
   if(reply?.status===true&&Array.isArray(reply.data)){
    const outgoing=reply.data.filter(m=>m.fromMe===true);
    const media=outgoing.filter(m=>['AUDIO','VOICE','PTT','VIDEO'].includes(String(m.type||'').toUpperCase()));
    const after=media.filter(m=>epoch(m.timestamp||m.createdAt)>=since-120_000);
    remote={state:'AVAILABLE',messages:reply.data.length,outboundMediaSinceIntro:after.map(m=>({
     kind:String(m.type||'').toUpperCase(),status:String(m.status||'').toUpperCase(),
     at:m.timestamp||m.createdAt,hasProviderId:!!(m.keyId||m.key?.id)
    })).slice(-8),recentOutboundMedia:media.length};
   }else remote={state:'UNAVAILABLE'};
  }catch{remote={state:'UNAVAILABLE'};}
 }
 return {
  state:'CHECKED',suffix:String(phone).slice(-4),leadStage:lead.stage,
  intro: intro?{stage:intro.stage,reason:intro.reason,sessionId:intro.session_id,
   sentAt:intro.sent_at,dueAt:intro.due_at,followupStatus:intro.followup_status}:null,
  manualTakeover:thread?.manual_takeover===1,
  recentInbound:inbox.map(m=>({state:m.state,at:m.received_at,
   explicitPermission:acceptsProposalAudio(m.body),asksProposal:wantsPortfolioPitchAudio(m.body),
   afterIntro:epoch(m.received_at)>=since,sessionMatches:m.session_id===intro?.session_id})),
  receipt:receipts.map(r=>({kind:r.kind,status:r.status,hasMessageId:!!r.provider_id,at:r.attempted_at})),
  locallyRecordedAudio:local.some(m=>String(m.provider_id||'').startsWith('intro-voice:')),
  locallyRecordedVideo:local.some(m=>String(m.provider_id||'').startsWith('intro-video:')),
  remote
 };
}
