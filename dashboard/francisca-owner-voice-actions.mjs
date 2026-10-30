// Voice commands can inspect the owner system and prepare work, never
// mutate blindly from speech. A text confirmation is required for actual
// system changes, with exact owner JID + session checked a second time.
import crypto from 'node:crypto';
import {db,one,run,now,audit} from './db.mjs';
import {classifyContact,verifiedOwnerPhone} from './whatsapp-roles.mjs';

db.exec("CREATE TABLE IF NOT EXISTS groq_owner_voice_actions(code TEXT PRIMARY KEY, tool_name TEXT NOT NULL, args_json TEXT NOT NULL, state TEXT NOT NULL, expires INTEGER NOT NULL, created_at TEXT NOT NULL)");
const READ=new Set([
 'list_capabilities','system_status','system_diagnostics','list_prospects','search_leads',
 'get_lead','list_conversations','read_conversation','whatsapp_status',
 'list_whatsapp_chats','read_whatsapp_chat','list_meetings','list_workflows',
 'read_audit_log','discovery_history','safe_settings','read_outreach_queue',
 'preview_outreach','list_media_library','get_workflow_details','read_owner_settings'
]);
// These tools create a proposal/confirmation code instead of executing their
// final effect. A one-off manual message is also only PREPARED at this step.
const PREPARE=new Set([
 'prepare_message','prepare_direct_message','request_start_outreach',
 'request_select_workflow','request_set_existing_client',
 'request_cancel_meeting','block_contact'
]);
const DEFER=new Set([
 'create_lead','update_lead','set_pause','create_meeting',
 'search_businesses','cancel_outreach','request_change_setting'
]);
export const OWNER_VOICE_READ_TOOLS=READ;
export const OWNER_VOICE_PREPARE_TOOLS=PREPARE;
export const OWNER_VOICE_DEFER_TOOLS=DEFER;

function authorized(actor){
 const identity=classifyContact({jid:actor?.jid,sessionId:actor?.sessionId});
 return identity.role==='OWNER'&&identity.ownerTools===true&&actor?.jid===verifiedOwnerPhone()+'@s.whatsapp.net';
}
const previewArgs=(name,a)=>({
 tool:name,
 recipientSuffix:String(a.phone||'').replace(/\D/g,'').slice(-4)||undefined,
 leadId:typeof a.lead_id==='string'?a.lead_id:undefined,
 meetingId:typeof a.meeting_id==='string'?a.meeting_id:undefined,
 requestedChanges:Object.keys(a||{}).filter(k=>!['text','notes','evidence'].includes(k)).slice(0,8),
 messagePreview:typeof a.text==='string'?a.text.slice(0,500):undefined
});
export function voiceToolsForOwner(tools,verified){
 if(!verified)return [];
 return tools.filter(t=>READ.has(t.function.name)||PREPARE.has(t.function.name)||DEFER.has(t.function.name));
}
function newCode(){
 for(let i=0;i<30;i++){
  const code=String(crypto.randomInt(100000,1000000));
  if(!one('SELECT code FROM groq_owner_voice_actions WHERE code=?',code)&&
     !one('SELECT code FROM groq_owner_confirmations WHERE code=?',code)&&
     !one('SELECT code FROM groq_owner_approvals WHERE code=?',code))
   return code;
 }
 throw Error('Não foi possível gerar confirmação exclusiva');
}
export async function runOwnerVoiceTool(name,args={},actor,execute){
 if(!authorized(actor))throw Error('VOICE_OWNER_UNVERIFIED');
 if(!args||typeof args!=='object'||Array.isArray(args))throw Error('VOICE_ARGUMENTS_INVALID');
 if(READ.has(name))return {kind:'READ',result:await execute(name,args,actor)};
 if(PREPARE.has(name)){
  const result=await execute(name,args,actor);
  return {kind:'PREPARED',result,requiresConfirmation:result?.requiresConfirmation===true,
   code:result?.code||undefined};
 }
 if(!DEFER.has(name))throw Error('VOICE_TOOL_NOT_PERMITTED');
 const payload=JSON.stringify(args);
 if(payload.length>6000)throw Error('VOICE_COMMAND_TOO_LARGE');
 const code=newCode(),expires=Date.now()+10*60_000;
 run("INSERT INTO groq_owner_voice_actions VALUES(?,?,?,?,?,?)",code,name,payload,'PENDING',expires,now());
 audit('FRANCISCA_OWNER_VOICE_ACTION_PREPARED',null,{name});
 return {kind:'STAGED',requiresConfirmation:true,code,preview:previewArgs(name,args),
  instruction:'A ação ainda NÃO ocorreu. Envie CONFIRMAR '+code+' pelo WhatsApp do proprietário em até 10 minutos.'};
}
export async function confirmOwnerVoiceTool(code,actor,execute){
 if(!authorized(actor))throw Error('VOICE_CONFIRMATION_UNVERIFIED');
 const row=one("SELECT * FROM groq_owner_voice_actions WHERE code=? AND state='PENDING' AND expires>?",String(code),Date.now());
 if(!row)return null;
 // Reserve before any external call or mutation; never retry uncertain actions.
 if(!run("UPDATE groq_owner_voice_actions SET state='UNKNOWN' WHERE code=? AND state='PENDING'",code).changes)
  return {ok:false,message:'Confirmação já usada. Confira o resultado no sistema.'};
 try{
  if(!DEFER.has(row.tool_name))throw Error('Operação não permitida');
  const result=await execute(row.tool_name,JSON.parse(row.args_json),actor);
  run("UPDATE groq_owner_voice_actions SET state='EXECUTED' WHERE code=? AND state='UNKNOWN'",code);
  audit('FRANCISCA_OWNER_VOICE_ACTION_EXECUTED',null,{name:row.tool_name});
  if(result?.requiresConfirmation)return {ok:true,message:'Primeira etapa validada. A operação ainda exige uma segunda confirmação: CONFIRMAR '+result.code+'.',result};
  return {ok:true,message:'Comando confirmado e processado no Prospector.',result};
 }catch(error){
  run("UPDATE groq_owner_voice_actions SET state='FAILED' WHERE code=? AND state='UNKNOWN'",code);
  audit('FRANCISCA_OWNER_VOICE_ACTION_FAILED',null,{name:row.tool_name});
  return {ok:false,message:'Não foi possível concluir: '+String(error.message).slice(0,180)};
 }
}
