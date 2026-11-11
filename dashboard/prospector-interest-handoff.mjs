// Immediately hand original-audio interested prospects to the owner.
// This path runs before automated call scheduling or Groq and sends NO customer message.
import {one,run,stage,audit} from './db.mjs';
import {ownerPitchStatus} from './owner-pitch-sequence.mjs';
import {isManagedSession,leadSession} from './waakg-session-registry.mjs';
import {interestedAfterProposal} from './prospector-sales-signals.mjs';
import {recordSalesOutcome} from './sales-outcomes.mjs';
import {queueNotice} from './notifications.mjs';

const clean=v=>String(v||'').replace(/[\r\n<>]/g,' ').replace(/\s+/g,' ').trim();
export function captureOwnerAudioInterest({leadId,sessionId,providerId,body}={}){
 if(process.env.PROSPECTOR_TENANT_ID)return {handled:false};
 if(!leadId||!providerId||!isManagedSession(sessionId)||leadSession(leadId)!==sessionId)return {handled:false};
 const pitch=ownerPitchStatus(leadId);
 if(!pitch||!['AUDIO_ACCEPTED','DONE'].includes(pitch.stage)||!pitch.audio_sent_at)
  return {handled:false};
 if(!interestedAfterProposal(body))return {handled:false};
 const lead=one('SELECT id,phone,business,name,stage FROM leads WHERE id=?',leadId);
 if(!lead||lead.stage==='NO_INTEREST'||lead.stage==='CLOSED_WON'||lead.stage==='INTERESTED'||
  one('SELECT phone FROM suppressions WHERE phone=?',lead.phone))return {handled:false};
 const thread=one('SELECT id,manual_takeover FROM threads WHERE lead_id=?',leadId);
 if(!thread||thread.manual_takeover===1)return {handled:false};
 stage(leadId,'INTERESTED','OWNER_AUDIO_INTEREST_HUMAN_HANDOFF');
 run('UPDATE threads SET manual_takeover=1 WHERE id=?',thread.id);
 recordSalesOutcome({leadId,status:'INTERESTED',providerId,evidence:body,notify:false});
 const phone=clean(lead.phone),name=clean(lead.name)||'Não informado',business=clean(lead.business)||'Empresa não informada';
 const message=[
  '⭐ *PROSPECTOR — interessado na proposta*',
  'Empresa: '+business,
  'Nome: '+name,
  'WhatsApp: '+phone,
  'Abrir conversa: https://wa.me/'+phone,
  'Resposta: '+clean(body).slice(0,180),
  'Atendimento assumido pelo proprietário. A IA foi interrompida.'
 ].join('\n');
 queueNotice('owner-audio-interest:'+leadId,'GROQ_HOT_LEAD',message,leadId);
 audit('OWNER_AUDIO_INTEREST_TO_GROUP_QUEUED',leadId,{providerId:String(providerId).slice(0,140),ownerTakeover:true});
 return {handled:true,state:'INTERESTED',notificationQueued:true,ownerTakeover:true};
}
